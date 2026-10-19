import { z } from "zod";
import { assertStoreLayoutAdoptable } from "@fl-copilot/commercial-core";
import {
  storeLayoutSchema,
  storeLayoutRevisionSchema,
  storeLayoutActionSchema,
  storeLayoutContentSchema,
  validateStoreLayoutTransition,
  type StoreLayout,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";

type Row = {
  id: string;
  store_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
const decode = (r: Row) => ({
  entity: storeLayoutSchema.parse(JSON.parse(r.payload_json)),
  remote: r.remote_payload_json
    ? storeLayoutSchema.parse(JSON.parse(r.remote_payload_json))
    : null,
  remoteVersion: r.remote_version,
  syncState: r.sync_state,
});
export async function applyStoreLayoutRevision(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  synced = true,
) {
  const revision = storeLayoutRevisionSchema.parse(payload);
  if (revision.storeId !== storeId) throw Error("STORE_LAYOUT_SCOPE_INVALID");
  const existing = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM store_layout_revisions WHERE id=?",
    revision.id,
  );
  const serialized = JSON.stringify(revision);
  if (existing && existing.payload_json !== serialized)
    throw Error("STORE_LAYOUT_HISTORY_CHANGED");
  await db.runAsync(
    "INSERT INTO store_layout_revisions(id,store_id,plan_version,payload_json,synced) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET synced=MAX(synced,excluded.synced)",
    revision.id,
    storeId,
    revision.plan.version,
    serialized,
    synced ? 1 : 0,
  );
}
export async function applyStoreLayout(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const p = storeLayoutSchema.parse(payload);
  if (p.storeId !== storeId) throw Error("STORE_LAYOUT_SCOPE_INVALID");
  await applyStoreLayoutRevision(db, storeId, {
    id: p.revisionId,
    storeId,
    plan: p,
    version: 1,
  });
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM store_layouts WHERE id=?",
    p.id,
  );
  if (row && row.store_id !== storeId)
    throw Error("STORE_LAYOUT_SCOPE_INVALID");
  const local = row ? decode(row) : null;
  if (local?.remote && local.remote.version > p.version) return;
  if (
    local?.remote &&
    local.remote.version === p.version &&
    JSON.stringify(local.remote) !== JSON.stringify(p)
  )
    throw Error("STORE_LAYOUT_HISTORY_CHANGED");
  if (
    row?.dirty &&
    (ackVersion === undefined ||
      local!.entity.version !== ackVersion ||
      local!.entity.revisionId !== p.revisionId)
  ) {
    await db.runAsync(
      "UPDATE store_layouts SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
      JSON.stringify(p),
      ackVersion ?? null,
      p.version,
      p.id,
    );
    return;
  }
  await db.runAsync(
    "INSERT INTO store_layouts(id,store_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    p.id,
    storeId,
    JSON.stringify(p),
    JSON.stringify(p),
    p.version,
  );
}
const saveSchema = z.strictObject({
  storeId: z.uuid(),
  expectedRevisionId: z.uuid().nullable(),
  action: storeLayoutActionSchema,
  content: storeLayoutContentSchema.optional(),
  restoredFromRevisionId: z.uuid().optional(),
});
const contextSchema = z.strictObject({
  commandId: z.uuid(),
  deviceId: z.uuid(),
  actorId: z.uuid(),
  canWrite: z.literal(true),
});
export class StoreLayoutRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private uuid: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async get(storeId: string) {
    const r = await this.db.getFirstAsync<Row>(
      "SELECT * FROM store_layouts WHERE store_id=?",
      storeId,
    );
    return r ? decode(r) : null;
  }
  async history(
    storeId: string,
    limit = 50,
    before?: { version: number; id: string },
  ) {
    z.uuid().parse(storeId);
    z.number().int().min(1).max(100).parse(limit);
    if (before) {
      z.number().int().positive().parse(before.version);
      z.uuid().parse(before.id);
    }
    const rows = await this.db.getAllAsync<{
      payload_json: string;
      synced: number;
    }>(
      "SELECT payload_json,synced FROM store_layout_revisions WHERE store_id=? AND (plan_version<? OR (plan_version=? AND id>?)) ORDER BY plan_version DESC,id ASC LIMIT ?",
      storeId,
      before?.version ?? Number.MAX_SAFE_INTEGER,
      before?.version ?? Number.MAX_SAFE_INTEGER,
      before?.id ?? "",
      limit,
    );
    return rows.map((r) => ({
      revision: storeLayoutRevisionSchema.parse(JSON.parse(r.payload_json)),
      synced: !!r.synced,
    }));
  }
  async reference(storeId: string) {
    const head = await this.get(storeId);
    if (!head?.entity.referenceRevisionId) return null;
    return this.revision(this.db, storeId, head.entity.referenceRevisionId);
  }
  async getRevision(storeId: string, id: string) {
    return this.revision(this.db, storeId, id);
  }
  private async revision(db: OutboxDatabase, storeId: string, id: string) {
    const r = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM store_layout_revisions WHERE id=? AND store_id=?",
      id,
      storeId,
    );
    return r
      ? storeLayoutRevisionSchema.parse(JSON.parse(r.payload_json)).plan
      : null;
  }
  async save(
    input: z.input<typeof saveSchema>,
    context: z.input<typeof contextSchema>,
  ) {
    const v = saveSchema.parse(input),
      ctx = contextSchema.parse(context),
      intent = JSON.stringify({ v, ctx });
    let result: StoreLayout | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const replay = await tx.getFirstAsync<{
        intent_json: string;
        payload_json: string;
      }>(
        "SELECT intent_json,payload_json FROM store_layout_operations WHERE command_id=?",
        ctx.commandId,
      );
      if (replay) {
        if (replay.intent_json !== intent)
          throw Error("STORE_LAYOUT_COMMAND_REUSED");
        result = storeLayoutSchema.parse(JSON.parse(replay.payload_json));
        return;
      }
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM store_layouts WHERE store_id=?",
          v.storeId,
        ),
        prev = row ? decode(row).entity : null;
      if (row && ["CONFLICT", "ERROR"].includes(row.sync_state))
        throw Error("STORE_LAYOUT_RESOLVE_REQUIRED");
      if ((prev?.revisionId ?? null) !== v.expectedRevisionId)
        throw Error("STORE_LAYOUT_SOURCE_CHANGED");
      if (
        (v.action === "SAVE_DRAFT") !== (v.content !== undefined) ||
        (v.action === "RESTORE_AS_DRAFT") !==
          (v.restoredFromRevisionId !== undefined)
      )
        throw Error("STORE_LAYOUT_ACTION_INVALID");
      const source = v.restoredFromRevisionId
        ? await this.revision(tx, v.storeId, v.restoredFromRevisionId)
        : null;
      const now = this.now(),
        revisionId = this.uuid();
      const next = validateStoreLayoutTransition(
        prev,
        storeLayoutSchema.parse({
          id: v.storeId,
          storeId: v.storeId,
          revisionId,
          parentRevisionId: prev?.revisionId ?? null,
          referenceRevisionId:
            v.action === "ADOPT_REFERENCE"
              ? revisionId
              : (prev?.referenceRevisionId ?? null),
          restoredFromRevisionId: v.restoredFromRevisionId ?? null,
          action: v.action,
          content: v.content ?? source?.content ?? prev?.content,
          version: (prev?.version ?? 0) + 1,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
          updatedBy: ctx.actorId,
        }),
        source,
      );
      if (next.action === "ADOPT_REFERENCE")
        assertStoreLayoutAdoptable(next.content);
      await this.write(tx, next, ctx, prev?.version ?? null);
      await tx.runAsync(
        "INSERT INTO store_layout_operations(command_id,store_id,intent_json,payload_json) VALUES(?,?,?,?)",
        ctx.commandId,
        v.storeId,
        intent,
        JSON.stringify(next),
      );
      result = next;
    });
    return result!;
  }
  private async write(
    tx: OutboxDatabase,
    p: StoreLayout,
    ctx: z.infer<typeof contextSchema>,
    expected: number | null,
  ) {
    await applyStoreLayoutRevision(
      tx,
      p.storeId,
      { id: p.revisionId, storeId: p.storeId, plan: p, version: 1 },
      false,
    );
    await tx.runAsync(
      "INSERT INTO store_layouts(id,store_id,payload_json,sync_state,dirty) VALUES(?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
      p.id,
      p.storeId,
      JSON.stringify(p),
    );
    await new OutboxRepository(tx).enqueue({
      commandId: ctx.commandId,
      deviceId: ctx.deviceId,
      storeId: p.storeId,
      commandType: "STORE_LAYOUT_UPSERT",
      entityType: "store_layout",
      entityId: p.id,
      expectedRemoteVersion: expected,
      payload: p,
      createdAt: p.updatedAt,
    });
  }
  async resolve(
    conflictId: string,
    choice: {
      useLocal: boolean;
      storeId: string;
      localRevisionId: string;
      remoteRevisionId: string;
    },
    context: z.input<typeof contextSchema>,
  ) {
    const ctx = contextSchema.parse(context);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const conflict = await new ConflictRepository(tx).getById(conflictId);
      if (
        !conflict ||
        conflict.status !== "OPEN" ||
        conflict.entityType !== "store_layout" ||
        conflict.storeId !== choice.storeId
      )
        throw Error("STORE_LAYOUT_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM store_layouts WHERE store_id=?",
          choice.storeId,
        ),
        remote = storeLayoutSchema.parse(conflict.remotePayload);
      if (!row) throw Error("STORE_LAYOUT_SOURCE_CHANGED");
      const local = decode(row),
        known = local.remote;
      if (
        local.entity.revisionId !== choice.localRevisionId ||
        remote.revisionId !== choice.remoteRevisionId ||
        remote.storeId !== choice.storeId ||
        (known &&
          known.version >= remote.version &&
          JSON.stringify(known) !== JSON.stringify(remote))
      )
        throw Error("STORE_LAYOUT_SOURCE_CHANGED");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox WHERE store_id=? AND entity_type='store_layout' AND status='SYNCING'",
        choice.storeId,
      );
      if (syncing?.n) throw Error("STORE_LAYOUT_SYNCING");
      await applyStoreLayoutRevision(tx, choice.storeId, {
        id: remote.revisionId,
        storeId: choice.storeId,
        plan: remote,
        version: 1,
      });
      const now = this.now();
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='STORE_LAYOUT_SUPERSEDED' WHERE store_id=? AND entity_type='store_layout' AND status IN ('PENDING','CONFLICT','FAILED')",
        choice.storeId,
      );
      await tx.runAsync(
        "UPDATE store_layouts SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state='SYNCED',dirty=0 WHERE store_id=?",
        JSON.stringify(remote),
        JSON.stringify(remote),
        remote.version,
        choice.storeId,
      );
      if (choice.useLocal) {
        const next = validateStoreLayoutTransition(
          remote,
          storeLayoutSchema.parse({
            ...remote,
            revisionId: this.uuid(),
            parentRevisionId: remote.revisionId,
            restoredFromRevisionId: null,
            action: "SAVE_DRAFT",
            content: local.entity.content,
            version: remote.version + 1,
            updatedBy: ctx.actorId,
            updatedAt: now,
          }),
        );
        await this.write(tx, next, ctx, remote.version);
      }
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='store_layout' AND status='OPEN'",
        choice.useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        choice.storeId,
      );
    });
  }
}
