import { ConflictRepository } from "../sync/conflict-repository";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotDraftSchema,
  type CopilotConversation,
  type CopilotMessage,
  type CopilotDraft,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
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
const schemas = {
  copilot_conversation: copilotConversationSchema,
  copilot_message: copilotMessageSchema,
};
const tables = {
  copilot_conversation: "copilot_conversations",
  copilot_message: "copilot_messages",
};
const identity = (a: CopilotConversation, b: CopilotConversation) =>
  a.id === b.id &&
  a.storeId === b.storeId &&
  a.ownerId === b.ownerId &&
  a.createdAt === b.createdAt;
function scoped(e: Scope, s: Scope) {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("COPILOT_HISTORY_SCOPE_INVALID");
}
export async function applyCopilotRecord(
  db: OutboxDatabase,
  scope: Scope,
  type: keyof typeof schemas,
  payload: unknown,
  ackVersion?: number,
) {
  const e = schemas[type].parse(payload);
  scoped(e, scope);
  const table = tables[type],
    old = await db.getFirstAsync<Row>(
      `SELECT * FROM ${table} WHERE id=?`,
      e.id,
    );
  if (old) scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
  const previous = old
    ? schemas[type].parse(JSON.parse(old.payload_json))
    : null;
  if (
    previous &&
    (type === "copilot_message"
      ? JSON.stringify(previous) !== JSON.stringify(e)
      : !identity(previous as CopilotConversation, e as CopilotConversation))
  )
    throw Error("COPILOT_HISTORY_IDENTITY_INVALID");
  if (
    old?.dirty &&
    (ackVersion === undefined || previous!.version !== ackVersion)
  ) {
    if (!old.remote_version || e.version >= old.remote_version)
      await db.runAsync(
        `UPDATE ${table} SET remote_payload_json=?,remote_version=? WHERE id=?`,
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  if (type === "copilot_message") {
    const m = e as CopilotMessage;
    const parent = await db.getFirstAsync<Row>(
      "SELECT * FROM copilot_conversations WHERE id=?",
      m.conversationId,
    );
    if (parent)
      scoped({ storeId: parent.store_id, ownerId: parent.owner_id }, scope);
    await db.runAsync(
      `INSERT INTO copilot_messages(id,store_id,owner_id,conversation_id,created_at,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
      m.id,
      m.storeId,
      m.ownerId,
      m.conversationId,
      m.createdAt,
      JSON.stringify(m),
      JSON.stringify(m),
      1,
    );
  } else
    await db.runAsync(
      `INSERT INTO copilot_conversations(id,store_id,owner_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
      e.id,
      e.storeId,
      e.ownerId,
      JSON.stringify(e),
      JSON.stringify(e),
      e.version,
    );
}
export class CopilotConversationRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
  ) {}
  async list(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error("COPILOT_PAGE_LIMIT_INVALID");
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE store_id=? AND owner_id=? ORDER BY json_extract(payload_json,'$.updatedAt') DESC,id DESC LIMIT ?",
        this.scope.storeId,
        this.scope.ownerId,
        limit,
      )
    ).map((r) => ({
      entity: copilotConversationSchema.parse(JSON.parse(r.payload_json)),
      syncState: r.sync_state,
      remote: r.remote_payload_json
        ? copilotConversationSchema.parse(JSON.parse(r.remote_payload_json))
        : null,
    }));
  }
  async save(
    e: CopilotConversation,
    ctx: { commandId: string; deviceId: string },
  ) {
    e = copilotConversationSchema.parse(e);
    scoped(e, this.scope);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE id=?",
        e.id,
      );
      if (row)
        scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const prior = row
        ? copilotConversationSchema.parse(JSON.parse(row.payload_json))
        : null;
      if (row?.sync_state === "CONFLICT" || row?.sync_state === "ERROR")
        throw Error("COPILOT_CONVERSATION_RECONCILE_REQUIRED");
      if (
        e.version !== (prior?.version ?? 0) + 1 ||
        (prior && !identity(prior, e))
      )
        throw Error("COPILOT_CONVERSATION_VERSION_INVALID");
      await tx.runAsync(
        "INSERT INTO copilot_conversations(id,store_id,owner_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        JSON.stringify(e),
      );
      await tx.runAsync(
        "INSERT INTO copilot_conversation_history(action_id,store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?,?)",
        ctx.commandId,
        e.storeId,
        e.ownerId,
        e.id,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_CONVERSATION_UPSERT",
        entityType: "copilot_conversation",
        entityId: e.id,
        expectedRemoteVersion: prior?.version ?? null,
        payload: e,
        createdAt: e.updatedAt,
      });
    });
    return e;
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
        conflict.entityType !== "copilot_conversation" ||
        conflict.storeId !== this.scope.storeId
      )
        throw Error("COPILOT_CONFLICT_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE id=?",
        conflict.entityId,
      );
      if (!row) throw Error("COPILOT_CONFLICT_INVALID");
      scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const local = copilotConversationSchema.parse(
          JSON.parse(row.payload_json),
        ),
        remote = copilotConversationSchema.parse(conflict.remotePayload);
      scoped(remote, this.scope);
      if (!identity(local, remote))
        throw Error("COPILOT_CONFLICT_IDENTITY_INVALID");
      const running = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='copilot_conversation' AND entity_id=? AND status='SYNCING'",
        this.scope.storeId,
        local.id,
      );
      if (running?.n) throw Error("COPILOT_CONVERSATION_SYNCING");
      const now = new Date().toISOString(),
        resolved = useLocal
          ? copilotConversationSchema.parse({
              ...local,
              version: remote.version + 1,
              updatedAt: now,
            })
          : remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='COPILOT_CONVERSATION_SUPERSEDED' WHERE store_id=? AND entity_type='copilot_conversation' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        local.storeId,
        local.id,
      );
      await tx.runAsync(
        "UPDATE copilot_conversations SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO copilot_conversation_history(action_id,store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?,?)",
        ctx.commandId,
        local.storeId,
        local.ownerId,
        local.id,
        JSON.stringify(local),
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='copilot_conversation' AND entity_id=? AND status='OPEN'",
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
          commandType: "COPILOT_CONVERSATION_UPSERT",
          entityType: "copilot_conversation",
          entityId: local.id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
    });
  }
  async append(
    e: CopilotMessage,
    ctx: { commandId: string; deviceId: string; preserveDraft?: boolean },
  ) {
    e = copilotMessageSchema.parse(e);
    scoped(e, this.scope);
    if (e.role !== "USER") throw Error("COPILOT_MESSAGE_ROLE_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const parent = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE id=?",
        e.conversationId,
      );
      if (!parent) throw Error("COPILOT_CONVERSATION_MISSING");
      scoped(
        { storeId: parent.store_id, ownerId: parent.owner_id },
        this.scope,
      );
      if (
        copilotConversationSchema.parse(JSON.parse(parent.payload_json))
          .status !== "ACTIVE"
      )
        throw Error("COPILOT_CONVERSATION_ARCHIVED");
      const old = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_messages WHERE id=?",
        e.id,
      );
      if (old) {
        if (old.payload_json !== JSON.stringify(e))
          throw Error("COPILOT_MESSAGE_IMMUTABLE");
        return;
      }
      for (const ref of [e.replyToMessageId, e.supersedesMessageId].filter(
        Boolean,
      )) {
        const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM copilot_messages WHERE id=?",
          ref!,
        );
        if (!row) throw Error("COPILOT_MESSAGE_PARENT_MISSING");
        const original = copilotMessageSchema.parse(
          JSON.parse(row.payload_json),
        );
        scoped(original, this.scope);
        if (
          original.conversationId !== e.conversationId ||
          (ref === e.supersedesMessageId && original.role !== "USER")
        )
          throw Error("COPILOT_MESSAGE_PARENT_INVALID");
      }
      await tx.runAsync(
        "INSERT INTO copilot_messages(id,store_id,owner_id,conversation_id,created_at,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,'PENDING',1)",
        e.id,
        e.storeId,
        e.ownerId,
        e.conversationId,
        e.createdAt,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_MESSAGE_APPEND",
        entityType: "copilot_message",
        entityId: e.id,
        expectedRemoteVersion: null,
        payload: e,
        createdAt: e.createdAt,
      });
      if (!ctx.preserveDraft)
        await tx.runAsync(
          "DELETE FROM copilot_drafts WHERE store_id=? AND owner_id=? AND conversation_id=?",
          e.storeId,
          e.ownerId,
          e.conversationId,
        );
    });
    return e;
  }
  async messages(
    conversationId: string,
    limit = 50,
    before?: { createdAt: string; id: string },
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error("COPILOT_PAGE_LIMIT_INVALID");
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM copilot_messages WHERE store_id=? AND owner_id=? AND conversation_id=? ${before ? "AND (created_at<? OR(created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
      ...(before ? [before.createdAt, before.createdAt, before.id] : []),
      limit + 1,
    );
    const hasMore = rows.length > limit,
      data = rows.slice(0, limit).map((r) => ({
        entity: copilotMessageSchema.parse(JSON.parse(r.payload_json)),
        syncState: r.sync_state,
      }));
    const last = data.at(-1)?.entity;
    return {
      messages: data.reverse(),
      hasMore,
      before: last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
  async saveDraft(conversationId: string, draft: CopilotDraft) {
    draft = copilotDraftSchema.parse(draft);
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM copilot_conversations WHERE id=?",
      conversationId,
    );
    if (!row) throw Error("COPILOT_CONVERSATION_MISSING");
    scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
    await this.db.runAsync(
      "INSERT OR REPLACE INTO copilot_drafts(store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?)",
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
      JSON.stringify(draft),
    );
  }
  async draft(conversationId: string) {
    const row = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_drafts WHERE store_id=? AND owner_id=? AND conversation_id=?",
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
    );
    return row ? copilotDraftSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}
