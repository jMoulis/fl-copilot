import { needUnitSchema, type NeedUnit } from "@fl-copilot/sync-contracts";
const sameIdentity = (a: NeedUnit, b: NeedUnit) =>
  a.id === b.id &&
  a.storeId === b.storeId &&
  a.createdAt === b.createdAt &&
  a.createdBy === b.createdBy;
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  readNeedConflictReview,
  requireNeedConflictDecision,
  type NeedConflictResolutionContext,
} from "./conflict-review";

type Row = {
  id: string;
  store_id: string;

  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalNeedUnit = {
  entity: NeedUnit;
  syncState: string;
  remoteVersion: number | null;
  remote: NeedUnit | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalNeedUnit {
  return {
    entity: needUnitSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? needUnitSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
  };
}
export async function applyNeedUnit(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = needUnitSchema.parse(payload);
  if (choice.storeId !== storeId) throw Error("NEED_UNIT_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM need_units WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("NEED_UNIT_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !sameIdentity({ ...local.entity, createdAt: choice.createdAt }, choice)
  )
    throw Error("NEED_UNIT_IDENTITY_CHANGED");
  if (local?.remote && local.remote.code !== choice.code)
    throw Error("NEED_UNIT_IDENTITY_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE need_units SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO need_units(id,store_id,code,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET code=excluded.code,payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    choice.code,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export class NeedUnitRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (s: string) => Promise<string> = async () => {
      throw Error("NEED_CONFLICT_DIGEST_REQUIRED");
    },
  ) {}
  review(storeId: string, conflictId: string) {
    return readNeedConflictReview(
      this.db,
      storeId,
      "NEED",
      conflictId,
      this.digest,
    );
  }
  async list(storeId: string) {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='need_unit' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM need_units p WHERE p.store_id=? ORDER BY json_extract(p.payload_json,'$.name')",
      storeId,
    );
    return rows.map(mapped);
  }
  async get(storeId: string, id: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='need_unit' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM need_units p WHERE p.store_id=? AND p.id=?",
      storeId,
      id,
    );
    return row ? mapped(row) : null;
  }
  async save(input: NeedUnit, ctx: { commandId: string; deviceId: string }) {
    const choice = needUnitSchema.parse(input),
      id = choice.id;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM need_units WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      const foreign = await tx.getFirstAsync<{ store_id: string }>(
        "SELECT store_id FROM need_units WHERE id=?",
        id,
      );
      if (foreign && foreign.store_id !== choice.storeId)
        throw Error("NEED_UNIT_STORE_INVALID");
      const duplicate = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM need_units WHERE store_id=? AND code=? AND id<>?",
        choice.storeId,
        choice.code,
        id,
      );
      if (duplicate) throw Error("NEED_UNIT_CODE_IN_USE");
      if (previous?.remoteVersion && previous.entity.code !== choice.code)
        throw Error("NEED_UNIT_CODE_IMMUTABLE");
      if (row?.sync_state === "CONFLICT")
        throw Error("NEED_UNIT_RESOLVE_REQUIRED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous && !sameIdentity(previous.entity, choice))
      )
        throw Error("NEED_UNIT_REVISION_INVALID");
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='need_unit' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("NEED_UNIT_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO need_units(id,store_id,code,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET code=excluded.code,payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        choice.code,
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO need_unit_history(action_id,need_unit_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "SAVE_NEED_UNIT",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "NEED_UNIT_UPSERT",
        entityType: "need_unit",
        entityId: id,
        expectedRemoteVersion: expected,
        payload: choice,
        createdAt: choice.updatedAt,
      });
    });
    return choice;
  }
  async resolve(
    conflictId: string,
    useLocal: boolean,
    ctx: NeedConflictResolutionContext,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("NEED_CONFLICT_FORBIDDEN");
      const review = await readNeedConflictReview(
        tx,
        ctx.storeId,
        "NEED",
        conflictId,
        this.digest,
      );
      requireNeedConflictDecision(review, useLocal, ctx);
      const local = needUnitSchema.parse(review.current.entity),
        remote = needUnitSchema.parse(review.group.remote);
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      const resolved = useLocal
        ? needUnitSchema.parse({
            ...local,
            createdAt: remote.createdAt,
            version: remote.version + 1,
            updatedAt: now,
          })
        : remote;
      await tx.runAsync(
        "UPDATE need_units SET code=?,payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        resolved.code,
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO need_unit_history(action_id,need_unit_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      if (
        !review.group.conflicts.some(
          (c) =>
            JSON.stringify(needUnitSchema.parse(c.remotePayload)) ===
            JSON.stringify(remote),
        )
      )
        await tx.runAsync(
          "INSERT INTO need_unit_history(action_id,need_unit_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
          ctx.remoteHistoryId,
          local.id,
          local.storeId,
          JSON.stringify(remote),
          "RESOLUTION_REMOTE_BASELINE",
          now,
        );
      for (const conflict of review.group.conflicts)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          now,
          conflict.id,
          local.storeId,
        );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "NEED_UNIT_UPSERT",
          entityType: "need_unit",
          entityId: local.id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("NEED_CONFLICT_FORBIDDEN");
    });
  }
}
async function retireCommands(tx: OutboxDatabase, storeId: string, id: string) {
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='NEED_UNIT_SUPERSEDED' WHERE store_id=? AND entity_type='need_unit' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}
