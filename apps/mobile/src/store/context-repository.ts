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
import { ConflictRepository } from "../sync/conflict-repository";

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
export class StoreContextRepository {
  constructor(private db: AtomicMutationDatabase & OutboxDatabase) {}
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
    ctx: { commandId: string; deviceId: string },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const conflict = await new ConflictRepository(tx).getById(conflictId);
      if (
        !conflict ||
        conflict.status !== "OPEN" ||
        conflict.entityType !== "store_context_settings"
      )
        throw Error("STORE_CONTEXT_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_context_settings WHERE id=? AND store_id=?",
        conflict.entityId,
        conflict.storeId,
      );
      if (!row) throw Error("STORE_CONTEXT_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = storeContextSettingsSchema.safeParse(conflict.remotePayload);
      const remote = parsed.success ? parsed.data : null;
      if (
        remote &&
        !sameIdentity({ ...local, createdAt: remote.createdAt }, remote)
      )
        throw Error("STORE_CONTEXT_SOURCE_CHANGED");
      if (!useLocal && !remote) throw Error("STORE_CONTEXT_REMOTE_MISSING");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='store_context_settings' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        local.id,
      );
      if (syncing?.n) throw Error("STORE_CONTEXT_SYNCING");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      const resolved = useLocal
        ? storeContextSettingsSchema.parse({
            ...local,
            createdAt: remote?.createdAt ?? local.createdAt,
            version: (remote?.version ?? 0) + 1,
            updatedAt: now,
          })
        : remote!;
      await tx.runAsync(
        "UPDATE store_context_settings SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
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
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='store_context_settings' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        local.storeId,
        local.id,
      );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "STORE_CONTEXT_SETTINGS_UPSERT",
          entityType: "store_context_settings",
          entityId: local.id,
          expectedRemoteVersion: remote?.version ?? null,
          payload: resolved,
          createdAt: now,
        });
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
