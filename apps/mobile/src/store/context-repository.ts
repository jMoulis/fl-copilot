import {
  storeContextSettingsSchema,
  type StoreContextSettings,
} from "@fl-copilot/sync-contracts";
const sameIdentity = (a: StoreContextSettings, b: StoreContextSettings) =>
  a.id === b.id && a.storeId === b.storeId && a.createdAt === b.createdAt;
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";

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
export type LocalStoreContext = {
  entity: StoreContextSettings;
  syncState: string;
  remoteVersion: number | null;
  remote: StoreContextSettings | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalStoreContext {
  return {
    entity: storeContextSettingsSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? storeContextSettingsSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
  };
}
export async function applyStoreContext(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = storeContextSettingsSchema.parse(payload);
  if (choice.storeId !== storeId) throw Error("STORE_CONTEXT_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM store_context_settings WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("STORE_CONTEXT_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !sameIdentity({ ...local.entity, createdAt: choice.createdAt }, choice)
  )
    throw Error("STORE_CONTEXT_IDENTITY_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE store_context_settings SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO store_context_settings(id,store_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export async function readStoreContextConflictReview(
  db: OutboxDatabase,
  storeId: string,
  conflictId: string,
  digest: (s: string) => Promise<string>,
) {
  const requested = await new ConflictRepository(db).getById(conflictId);
  if (
    !requested ||
    requested.storeId !== storeId ||
    requested.status !== "OPEN" ||
    requested.entityType !== "store_context_settings"
  )
    throw Error("STORE_CONTEXT_RESOLUTION_INVALID");
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM store_context_settings WHERE id=? AND store_id=?",
    requested.entityId,
    storeId,
  );
  if (!row) throw Error("STORE_CONTEXT_RESOLUTION_INVALID");
  const current = mapped(row),
    local = current.entity;
  if (local.storeId !== storeId || local.id !== requested.entityId)
    throw Error("STORE_CONTEXT_SOURCE_CHANGED");
  const conflicts = await new ConflictRepository(db).listOpenForEntity(
      storeId,
      "store_context_settings",
      local.id,
    ),
    group = reviewConflictVersions(
      conflicts,
      (raw) => {
        const result = storeContextSettingsSchema.safeParse(raw);
        return result.success ? result.data : null;
      },
      (remote) =>
        sameIdentity({ ...local, createdAt: remote.createdAt }, remote),
      current.remote,
    ),
    commands = await db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version FROM sync_outbox WHERE store_id=? AND entity_type='store_context_settings' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
      storeId,
      local.id,
    );
  const canResolve =
    group.valid &&
    !!group.remote &&
    current.syncState === "CONFLICT" &&
    (current.remoteVersion ?? 0) <= group.remote.version &&
    commands.length <= 100 &&
    !commands.some((c) => c.status === "SYNCING");
  const reason =
    group.reason ??
    (canResolve
      ? null
      : commands.some((c) => c.status === "SYNCING")
        ? "Un envoi des réglages est en cours. Attendez sa fin avant de comparer."
        : "Les réglages ont changé ou leur version distante ne peut pas être vérifiée. Relisez la comparaison avant de décider.");
  const hash = await digest(
    JSON.stringify({ row, conflicts, commands, remote: group.remote }),
  );
  return { current, group, hash, canResolve, reason };
}
export class StoreContextRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (s: string) => Promise<string> = async () => {
      throw Error("STORE_CONTEXT_DIGEST_REQUIRED");
    },
  ) {}
  review(storeId: string, conflictId: string) {
    return readStoreContextConflictReview(
      this.db,
      storeId,
      conflictId,
      this.digest,
    );
  }
  async get(storeId: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='store_context_settings' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM store_context_settings p WHERE p.store_id=?",
      storeId,
    );
    return row ? mapped(row) : null;
  }
  async save(
    input: StoreContextSettings,
    ctx: { commandId: string; deviceId: string },
    baseline?: StoreContextSettings | null,
  ) {
    const choice = storeContextSettingsSchema.parse(input),
      id = choice.storeId;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM store_context_settings WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      if (row?.sync_state === "CONFLICT")
        throw Error("STORE_CONTEXT_RESOLVE_REQUIRED");
      if (
        baseline !== undefined &&
        JSON.stringify(previous?.entity ?? null) !== JSON.stringify(baseline)
      )
        throw Error("STORE_CONTEXT_CHANGED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous && !sameIdentity(previous.entity, choice))
      )
        throw Error("STORE_CONTEXT_REVISION_INVALID");
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='store_context_settings' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("STORE_CONTEXT_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO store_context_settings(id,store_id,payload_json,sync_state,dirty) VALUES(?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO store_context_history(action_id,settings_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "SAVE_SETTINGS",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "STORE_CONTEXT_SETTINGS_UPSERT",
        entityType: "store_context_settings",
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
    ctx: {
      storeId: string;
      commandId: string;
      remoteHistoryId: string;
      deviceId: string;
      reviewHash: string;
      canResolve: () => boolean;
      signal?: AbortSignal;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_CONTEXT_FORBIDDEN");
      const review = await readStoreContextConflictReview(
          tx,
          ctx.storeId,
          conflictId,
          this.digest,
        ),
        local = review.current.entity,
        remote = review.group.remote;
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_CONTEXT_FORBIDDEN");
      if (!review.canResolve || review.hash !== ctx.reviewHash || !remote)
        throw Error("STORE_CONTEXT_SOURCE_CHANGED");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString(),
        resolved = useLocal
          ? storeContextSettingsSchema.parse({
              ...local,
              createdAt: remote.createdAt,
              version: remote.version + 1,
              updatedAt: now,
            })
          : remote;
      await tx.runAsync(
        "UPDATE store_context_settings SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=? AND store_id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
        local.storeId,
      );
      await tx.runAsync(
        "INSERT INTO store_context_history(action_id,settings_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
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
            JSON.stringify(
              storeContextSettingsSchema.parse(c.remotePayload),
            ) === JSON.stringify(remote),
        )
      )
        await tx.runAsync(
          "INSERT INTO store_context_history(action_id,settings_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
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
          commandType: "STORE_CONTEXT_SETTINGS_UPSERT",
          entityType: "store_context_settings",
          entityId: local.id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_CONTEXT_FORBIDDEN");
    });
  }
}

async function retireCommands(tx: OutboxDatabase, storeId: string, id: string) {
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='STORE_CONTEXT_SUPERSEDED' WHERE store_id=? AND entity_type='store_context_settings' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}
