import {
  copilotKnowledgeSchema,
  copilotMessageSchema,
  type CopilotKnowledge,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
type Scope = { storeId: string; ownerId: string };
type Row = {
  store_id: string;
  owner_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
function scoped(e: Scope, s: Scope) {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("COPILOT_KNOWLEDGE_SCOPE_INVALID");
}
const same = (a: CopilotKnowledge, b: CopilotKnowledge) =>
  a.id === b.id &&
  a.createdAt === b.createdAt &&
  a.sourceMessageId === b.sourceMessageId &&
  a.ownerId === b.ownerId &&
  a.storeId === b.storeId;
export async function applyKnowledgeRecord(
  db: OutboxDatabase,
  scope: Scope,
  payload: unknown,
  ackVersion?: number,
) {
  const e = copilotKnowledgeSchema.parse(payload);
  scoped(e, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_knowledge WHERE id=?",
    e.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (!same(copilotKnowledgeSchema.parse(JSON.parse(old.payload_json)), e))
      throw Error("COPILOT_KNOWLEDGE_IDENTITY_INVALID");
  }
  if (
    old?.dirty &&
    (ackVersion === undefined ||
      JSON.parse(old.payload_json).version !== ackVersion)
  ) {
    if ((old.remote_version ?? 0) <= e.version)
      await db.runAsync(
        "UPDATE copilot_knowledge SET remote_payload_json=?,remote_version=? WHERE id=?",
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO copilot_knowledge(id,store_id,owner_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export class CopilotKnowledgeRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
  ) {}
  async list() {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM copilot_knowledge WHERE store_id=? AND owner_id=? ORDER BY json_extract(payload_json,'$.updatedAt') DESC,id",
        this.scope.storeId,
        this.scope.ownerId,
      )
    ).map((r) => ({
      entity: copilotKnowledgeSchema.parse(JSON.parse(r.payload_json)),
      syncState: r.sync_state,
      remote: r.remote_payload_json
        ? copilotKnowledgeSchema.parse(JSON.parse(r.remote_payload_json))
        : null,
    }));
  }
  async source(id: string) {
    const r = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
      id,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!r) throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
    const m = copilotMessageSchema.parse(JSON.parse(r.payload_json));
    scoped(m, this.scope);
    if (m.role !== "USER") throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
    return m;
  }
  async save(
    raw: CopilotKnowledge,
    ctx: { commandId: string; deviceId: string },
  ) {
    const e = copilotKnowledgeSchema.parse(raw);
    scoped(e, this.scope);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_knowledge WHERE id=?",
        e.id,
      );
      if (row)
        scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const before = row
        ? copilotKnowledgeSchema.parse(JSON.parse(row.payload_json))
        : null;
      if (row && ["CONFLICT", "ERROR"].includes(row.sync_state))
        throw Error("COPILOT_KNOWLEDGE_REVIEW_REQUIRED");
      if (
        e.version !== (before?.version ?? 0) + 1 ||
        (before && !same(before, e))
      )
        throw Error("COPILOT_KNOWLEDGE_REVISION_INVALID");
      if (e.sourceMessageId && !before) {
        const source = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
          e.sourceMessageId,
          e.storeId,
          e.ownerId,
        );
        if (
          !source ||
          copilotMessageSchema.parse(JSON.parse(source.payload_json)).role !==
            "USER"
        )
          throw Error("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
      }
      await tx.runAsync(
        "INSERT INTO copilot_knowledge(id,store_id,owner_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_KNOWLEDGE_UPSERT",
        entityType: "copilot_knowledge",
        entityId: e.id,
        expectedRemoteVersion: before?.version ?? null,
        payload: e,
        createdAt: e.updatedAt,
      });
    });
  }
  async resolve(
    id: string,
    useLocal: boolean,
    ctx: { commandId: string; deviceId: string },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_knowledge WHERE id=?",
        id,
      );
      if (!row || !["CONFLICT", "ERROR"].includes(row.sync_state))
        throw Error("COPILOT_KNOWLEDGE_REVIEW_REQUIRED");
      scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const local = copilotKnowledgeSchema.parse(JSON.parse(row.payload_json)),
        remote = row.remote_payload_json
          ? copilotKnowledgeSchema.parse(JSON.parse(row.remote_payload_json))
          : null;
      if (remote && !same(local, remote))
        throw Error("COPILOT_KNOWLEDGE_IDENTITY_INVALID");
      if (!useLocal && !remote) throw Error("COPILOT_KNOWLEDGE_REMOTE_MISSING");
      const running = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='copilot_knowledge' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        id,
      );
      if (running?.n) throw Error("COPILOT_KNOWLEDGE_SYNCING");
      const now = new Date().toISOString(),
        resolved = useLocal
          ? copilotKnowledgeSchema.parse({
              ...local,
              version: (remote?.version ?? 0) + 1,
              updatedAt: now,
            })
          : remote!;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='COPILOT_KNOWLEDGE_SUPERSEDED' WHERE store_id=? AND entity_type='copilot_knowledge' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        local.storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE copilot_knowledge SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        id,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='copilot_knowledge' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        local.storeId,
        id,
      );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COPILOT_KNOWLEDGE_UPSERT",
          entityType: "copilot_knowledge",
          entityId: id,
          expectedRemoteVersion: remote?.version ?? null,
          payload: resolved,
          createdAt: now,
        });
    });
  }
}
