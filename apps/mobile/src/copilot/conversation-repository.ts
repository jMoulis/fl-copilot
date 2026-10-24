import { applyIllustrationGenerationRecord } from "./layout-illustration-generation-repository";
import { applyEmailDecisionRecord } from "../intake/email-decision-repository";
import { MAX_STORE_PHOTOS_PER_TURN } from "@fl-copilot/domain";
import { applyActionExecutionRecord } from "./action-execution-repository";
import { applyExecutionLinkRecord } from "./execution-link-repository";
import { applyDecisionRecord } from "./decision-repository";
import { RECEIPT_PHOTO_BUNDLE_MIME } from "@fl-copilot/domain";
import { readReceiptPhotoViews } from "../documents/receipt-photo-views";
import { copilotMessageIsDeleted } from "@fl-copilot/domain";
import { applyKnowledgeRecord } from "./knowledge-repository";
import {
  readConversationConflictReview,
  type ConversationResolutionContext,
} from "./conversation-conflict-review";
import {
  preserveCopilotConversationDeletions,
  copilotConversationMetadataEqual,
} from "@fl-copilot/domain";
import { applyLayoutIllustrationRecord } from "./layout-illustration-repository";
import {
  copilotTurnRequestSchema,
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
  type:
    | keyof typeof schemas
    | "email_intake_decision"
    | "copilot_knowledge"
    | "copilot_decision"
    | "copilot_execution_link"
    | "copilot_action_execution"
    | "copilot_layout_illustration_generation"
    | "copilot_layout_illustration",

  payload: unknown,
  ackVersion?: number,
) {
  if (type === "copilot_layout_illustration_generation")
    return applyIllustrationGenerationRecord(db, scope, payload, ackVersion);
  if (type === "copilot_layout_illustration")
    return applyLayoutIllustrationRecord(db, scope, payload, ackVersion);
  if (type === "email_intake_decision")
    return applyEmailDecisionRecord(db, scope, payload, ackVersion);
  if (type === "copilot_action_execution")
    return applyActionExecutionRecord(db, scope, payload, ackVersion);
  if (type === "copilot_execution_link")
    return applyExecutionLinkRecord(db, scope, payload, ackVersion);
  if (type === "copilot_decision")
    return applyDecisionRecord(db, scope, payload, ackVersion);
  if (type === "copilot_knowledge")
    return applyKnowledgeRecord(db, scope, payload, ackVersion);
  let e = schemas[type].parse(payload);
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
  let sameMessage = false;
  if (type === "copilot_message" && previous) {
    const {
      analyticsDestinations: before,
      answerSources: previousSources,
      ...previousBody
    } = previous as CopilotMessage;
    const {
      analyticsDestinations: after,
      answerSources: nextSources,
      ...nextBody
    } = e as CopilotMessage;
    sameMessage =
      JSON.stringify(previousBody) === JSON.stringify(nextBody) &&
      (!before || !after || JSON.stringify(before) === JSON.stringify(after)) &&
      (!previousSources ||
        !nextSources ||
        JSON.stringify(previousSources) === JSON.stringify(nextSources));
    if (sameMessage && previousSources && !nextSources)
      e = { ...e, answerSources: previousSources } as CopilotMessage;
    // An older projected response cannot erase an already-restored destination.
    if (sameMessage && before && !after)
      e = { ...e, analyticsDestinations: before } as CopilotMessage;
  }
  if (
    previous &&
    (type === "copilot_message"
      ? !sameMessage
      : !identity(previous as CopilotConversation, e as CopilotConversation))
  )
    throw Error("COPILOT_HISTORY_IDENTITY_INVALID");
  if (
    old?.dirty &&
    (ackVersion === undefined || previous!.version !== ackVersion)
  ) {
    if (!old.remote_version || e.version >= old.remote_version) {
      if (type === "copilot_conversation") {
        const effective = preserveCopilotConversationDeletions(
          previous as CopilotConversation,
          e as CopilotConversation,
        );
        await db.runAsync(
          "UPDATE copilot_conversations SET payload_json=?,remote_payload_json=?,remote_version=? WHERE id=?",
          JSON.stringify(effective),
          JSON.stringify(e),
          e.version,
          e.id,
        );
      } else
        await db.runAsync(
          `UPDATE ${table} SET remote_payload_json=?,remote_version=? WHERE id=?`,
          JSON.stringify(e),
          e.version,
          e.id,
        );
    }
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
      `INSERT INTO copilot_messages(id,store_id,owner_id,conversation_id,created_at,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
      m.id,
      m.storeId,
      m.ownerId,
      m.conversationId,
      m.createdAt,
      JSON.stringify(m),
      JSON.stringify(m),
      1,
    );
    if (m.role === "ASSISTANT" && m.replyToMessageId) {
      // A canonical pull is also a delivery receipt. Never leave an answered
      // question queued, and never settle another question/conversation/owner.
      await db.runAsync(
        `UPDATE copilot_pending_turns SET status='APPLIED',updated_at=?
         WHERE reply_id=? AND store_id=? AND owner_id=? AND conversation_id=?
         AND user_message_id=? AND status='PENDING'
         AND EXISTS (SELECT 1 FROM copilot_messages p
           WHERE p.id=copilot_pending_turns.user_message_id
           AND p.store_id=copilot_pending_turns.store_id
           AND p.owner_id=copilot_pending_turns.owner_id
           AND p.conversation_id=copilot_pending_turns.conversation_id
           AND json_extract(p.payload_json,'$.role')='USER'
           AND julianday(p.created_at)<=julianday(?))`,
        m.createdAt,
        m.id,
        m.storeId,
        m.ownerId,
        m.conversationId,
        m.replyToMessageId,
        m.createdAt,
      );
    }
  } else {
    const remote = e as CopilotConversation,
      effective = previous
        ? preserveCopilotConversationDeletions(
            remote,
            remote,
            previous as CopilotConversation,
          )
        : remote,
      needsReview = !copilotConversationMetadataEqual(remote, effective);
    await db.runAsync(
      `INSERT INTO copilot_conversations(id,store_id,owner_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state=excluded.sync_state,dirty=excluded.dirty`,
      e.id,
      e.storeId,
      e.ownerId,
      JSON.stringify(effective),
      JSON.stringify(remote),
      e.version,
      needsReview ? "ERROR" : "SYNCED",
      needsReview ? 1 : 0,
    );
  }
}
export class CopilotConversationRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
    private digest: (s: string) => Promise<string> = async () => {
      throw Error("COPILOT_CONVERSATION_DIGEST_REQUIRED");
    },
  ) {}
  review(id: string) {
    return readConversationConflictReview(this.db, this.scope, id, this.digest);
  }
  async get(conversationId: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
      conversationId,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!row) return null;
    const entity = copilotConversationSchema.parse(
      JSON.parse(row.payload_json),
    );
    scoped(entity, this.scope);
    if (entity.id !== conversationId)
      throw Error("COPILOT_HISTORY_IDENTITY_INVALID");
    return entity;
  }
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
      if (
        prior &&
        ((prior.deletedAt &&
          (prior.deletedAt !== e.deletedAt || e.status !== "ARCHIVED")) ||
          (prior.deletedMessageIds ?? []).some(
            (id) => !e.deletedMessageIds?.includes(id),
          ))
      )
        throw Error("COPILOT_DELETION_IMMUTABLE");
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
  async remove(
    conversationId: string,
    messageId: string | null,
    ctx: { commandId: string; deviceId: string },
    timestamp: string,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const joined = {
        getFirstAsync: tx.getFirstAsync.bind(tx),
        getAllAsync: tx.getAllAsync.bind(tx),
        runAsync: tx.runAsync.bind(tx),
        withExclusiveTransactionAsync: (
          work: (t: OutboxDatabase) => Promise<void>,
        ) => work(tx),
      };
      const repo = new CopilotConversationRepository(joined, this.scope);
      const before = await repo.get(conversationId);
      if (!before) throw Error("COPILOT_CONVERSATION_MISSING");
      if (before.deletedAt) return;
      if (before.status !== "ACTIVE")
        throw Error("COPILOT_CONVERSATION_ARCHIVED");
      if (messageId) {
        const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM copilot_messages WHERE id=? AND conversation_id=? AND store_id=? AND owner_id=?",
          messageId,
          conversationId,
          this.scope.storeId,
          this.scope.ownerId,
        );
        if (!row) throw Error("COPILOT_MESSAGE_MISSING");
        const message = copilotMessageSchema.parse(
          JSON.parse(row.payload_json),
        );
        if (message.role === "TOOL")
          throw Error("COPILOT_MESSAGE_ROLE_INVALID");
        if (copilotMessageIsDeleted(message, before)) return;
        await repo.save(
          {
            ...before,
            deletedMessageIds: [...(before.deletedMessageIds ?? []), messageId],
            version: before.version + 1,
            updatedAt: timestamp,
          },
          ctx,
        );
        const pendingParent =
          message.role === "USER" ? message.id : message.replyToMessageId;
        if (pendingParent)
          await tx.runAsync(
            "DELETE FROM copilot_pending_turns WHERE store_id=? AND owner_id=? AND conversation_id=? AND user_message_id=?",
            this.scope.storeId,
            this.scope.ownerId,
            conversationId,
            pendingParent,
          );
      } else {
        await repo.save(
          {
            ...before,
            status: "ARCHIVED",
            deletedAt: timestamp,
            version: before.version + 1,
            updatedAt: timestamp,
          },
          ctx,
        );
        await tx.runAsync(
          "DELETE FROM copilot_pending_turns WHERE store_id=? AND owner_id=? AND conversation_id=?",
          this.scope.storeId,
          this.scope.ownerId,
          conversationId,
        );
        await tx.runAsync(
          "DELETE FROM copilot_drafts WHERE store_id=? AND owner_id=? AND conversation_id=?",
          this.scope.storeId,
          this.scope.ownerId,
          conversationId,
        );
      }
    });
  }
  async resolve(
    id: string,
    useLocal: boolean,
    ctx: ConversationResolutionContext,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = () =>
        ctx.canResolve() &&
        !ctx.signal?.aborted &&
        this.scope.storeId === ctx.storeId &&
        this.scope.ownerId === ctx.ownerId;
      if (!current()) throw Error("COPILOT_CONVERSATION_FORBIDDEN");
      if (!ctx.reviewCaptureId || ctx.reviewCaptureId === ctx.commandId)
        throw Error("COPILOT_CONVERSATION_CAPTURE_ID_INVALID");
      const review = await readConversationConflictReview(
          tx,
          this.scope,
          id,
          this.digest,
        ),
        local = review.current.entity,
        remote = review.group.remote,
        chosen = useLocal ? review.localChoice : review.remoteChoice;
      if (!current()) throw Error("COPILOT_CONVERSATION_FORBIDDEN");
      if (!review.ready || !remote || !chosen || review.hash !== ctx.reviewHash)
        throw Error("COPILOT_CONVERSATION_REVIEW_CHANGED");
      const now = new Date().toISOString(),
        send = !copilotConversationMetadataEqual(chosen, remote),
        resolved = send
          ? copilotConversationSchema.parse({
              ...chosen,
              version: remote.version + 1,
              updatedAt: new Date(
                Math.max(Date.parse(now), Date.parse(chosen.updatedAt)),
              ).toISOString(),
            })
          : remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='COPILOT_CONVERSATION_SUPERSEDED' WHERE store_id=? AND entity_type='copilot_conversation' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        local.storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE copilot_conversations SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        send ? "PENDING" : "SYNCED",
        send ? 1 : 0,
        id,
      );
      await tx.runAsync(
        "INSERT INTO copilot_conversation_history(action_id,store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?,?)",
        ctx.commandId,
        local.storeId,
        local.ownerId,
        id,
        JSON.stringify(local),
      );
      await tx.runAsync(
        "INSERT INTO sync_conflicts(id,store_id,command_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at,resolved_at) VALUES(?,?,NULL,'copilot_conversation',?,?,?,?,?,'COPILOT_CONVERSATION_REVIEW_CAPTURE',?,?,?)",
        ctx.reviewCaptureId,
        local.storeId,
        id,
        JSON.stringify(local),
        JSON.stringify(remote),
        review.current.remoteVersion,
        remote.version,
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
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
      if (send)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COPILOT_CONVERSATION_UPSERT",
          entityType: "copilot_conversation",
          entityId: id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!current()) throw Error("COPILOT_CONVERSATION_FORBIDDEN");
    });
  }
  async append(
    e: CopilotMessage,
    ctx: {
      commandId: string;
      deviceId: string;
      preserveDraft?: boolean;
      replyId?: string;
    },
  ) {
    e = copilotMessageSchema.parse(e);
    scoped(e, this.scope);
    if (e.role !== "USER") throw Error("COPILOT_MESSAGE_ROLE_INVALID");
    const pending = ctx.replyId
      ? copilotTurnRequestSchema.parse({
          replyId: ctx.replyId,
          conversationId: e.conversationId,
          userMessageId: e.id,
        })
      : null;
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
      if (pending)
        await tx.runAsync(
          "INSERT INTO copilot_pending_turns(reply_id,store_id,owner_id,conversation_id,user_message_id,status,updated_at) VALUES(?,?,?,?,?,'PENDING',?)",
          pending.replyId,
          e.storeId,
          e.ownerId,
          e.conversationId,
          e.id,
          e.createdAt,
        );
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
  async pendingTurns(conversationId: string) {
    const parent = await this.get(conversationId);
    if (!parent || parent.status !== "ACTIVE" || parent.deletedAt) return [];
    const rows = await this.db.getAllAsync<{
      reply_id: string;
      conversation_id: string;
      user_message_id: string;
    }>(
      "SELECT reply_id,conversation_id,user_message_id FROM copilot_pending_turns WHERE store_id=? AND owner_id=? AND conversation_id=? AND status='PENDING' ORDER BY updated_at,rowid",
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
    );
    return rows
      .filter((row) => !parent.deletedMessageIds?.includes(row.user_message_id))
      .map((row) =>
        copilotTurnRequestSchema.parse({
          replyId: row.reply_id,
          conversationId: row.conversation_id,
          userMessageId: row.user_message_id,
        }),
      );
  }
  async messages(
    conversationId: string,
    limit = 50,
    before?: { createdAt: string; id: string },
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error("COPILOT_PAGE_LIMIT_INVALID");
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM copilot_messages WHERE store_id=? AND owner_id=? AND conversation_id=? AND NOT (json_extract(payload_json,'$.role')='USER' AND COALESCE(CASE WHEN json_valid(json_extract(payload_json,'$.text')) THEN json_extract(json_extract(payload_json,'$.text'),'$.kind')='MERCALYS_CHAT_IMPORT_STATUS' ELSE 0 END,0)) ${before ? "AND (created_at<? OR(created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
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
  async appendIntakeQuestion(
    conversationId: string,
    question: string,
    updatedAt: string,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE id=?",
        conversationId,
      );
      if (!row) throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
      scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      const conversation = copilotConversationSchema.parse(
        JSON.parse(row.payload_json),
      );
      scoped(conversation, this.scope);
      if (
        conversation.id !== conversationId ||
        conversation.status !== "ACTIVE"
      )
        throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
      const current = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_drafts WHERE store_id=? AND owner_id=? AND conversation_id=?",
        this.scope.storeId,
        this.scope.ownerId,
        conversationId,
      );
      const draft = current
        ? copilotDraftSchema.parse(JSON.parse(current.payload_json))
        : null;
      const text = draft?.text.trim()
        ? `${draft.text}\n\n${question}`
        : question;
      if (!question.trim() || question.length > 1000 || text.length > 6000)
        throw Error("COPILOT_DRAFT_TOO_LONG");
      const next = copilotDraftSchema.parse({
        text,
        attachments: draft?.attachments ?? [],
        updatedAt,
      });
      await tx.runAsync(
        "INSERT OR REPLACE INTO copilot_drafts(store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?)",
        this.scope.storeId,
        this.scope.ownerId,
        conversationId,
        JSON.stringify(next),
      );
    });
  }
  attachPdf(
    conversationId: string,
    sourceDocumentId: string,
    updatedAt: string,
    signal?: AbortSignal,
  ) {
    return this.attachPdfs(
      conversationId,
      [sourceDocumentId],
      updatedAt,
      signal,
    );
  }
  /** Bind retained sources to a local draft; removal never deletes the original. */
  attachPdfs(
    conversationId: string,
    sourceDocumentIds: string[],
    updatedAt: string,
    signal?: AbortSignal,
  ) {
    return this.attachSources(
      conversationId,
      sourceDocumentIds,
      updatedAt,
      signal,
      "WEEKLY_COMMERCIAL_PDF",
    );
  }
  attachReceiptPhotos(
    conversationId: string,
    sourceDocumentIds: string[],
    updatedAt: string,
    signal?: AbortSignal,
  ) {
    return this.attachSources(
      conversationId,
      sourceDocumentIds,
      updatedAt,
      signal,
      "WASTE_RECEIPT",
    );
  }
  attachStorePhotos(
    conversationId: string,
    sourceDocumentIds: string[],
    updatedAt: string,
    signal?: AbortSignal,
  ) {
    return this.attachSources(
      conversationId,
      sourceDocumentIds,
      updatedAt,
      signal,
      "STORE_PHOTO",
    );
  }
  private async attachSources(
    conversationId: string,
    sourceDocumentIds: string[],
    updatedAt: string,
    signal: AbortSignal | undefined,
    kind: "WEEKLY_COMMERCIAL_PDF" | "WASTE_RECEIPT" | "STORE_PHOTO",
  ) {
    const ids = [...new Set(sourceDocumentIds)];
    if (!ids.length || ids.length > 10) throw Error("COPILOT_ATTACHMENT_LIMIT");
    let result: CopilotDraft | undefined;
    const cancelled = () => {
      if (signal?.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
    };
    cancelled();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const conversationRow = await tx.getFirstAsync<Row>(
        "SELECT * FROM copilot_conversations WHERE id=?",
        conversationId,
      );
      if (!conversationRow) throw Error("COPILOT_CONVERSATION_MISSING");
      scoped(
        {
          storeId: conversationRow.store_id,
          ownerId: conversationRow.owner_id,
        },
        this.scope,
      );
      const conversation = copilotConversationSchema.parse(
        JSON.parse(conversationRow.payload_json),
      );
      scoped(conversation, this.scope);
      if (
        conversation.id !== conversationId ||
        conversation.status !== "ACTIVE"
      )
        throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
      const row = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_drafts WHERE store_id=? AND owner_id=? AND conversation_id=?",
        this.scope.storeId,
        this.scope.ownerId,
        conversationId,
      );
      const draft = row
        ? copilotDraftSchema.parse(JSON.parse(row.payload_json))
        : { text: "", attachments: [], updatedAt };
      const attachments = [...draft.attachments];
      if (
        attachments.length +
          ids.filter(
            (id) => !attachments.some((a) => a.sourceDocumentId === id),
          ).length >
        10
      )
        throw Error("COPILOT_ATTACHMENT_LIMIT");
      for (const sourceDocumentId of ids) {
        const source = await tx.getFirstAsync<{ original_filename: string }>(
          "SELECT original_filename FROM source_documents WHERE id=? AND store_id=? AND source_type=? AND deleted_at IS NULL",
          sourceDocumentId,
          this.scope.storeId,
          kind,
        );
        const files =
          kind === "WASTE_RECEIPT"
            ? await tx.getAllAsync<{ id: string; mime_type: string }>(
                "SELECT f.id,f.mime_type FROM local_files f JOIN source_documents d ON d.id=f.source_document_id AND d.store_id=f.store_id AND d.checksum=f.checksum JOIN waste_receipts r ON r.source_document_id=d.id AND r.store_id=d.store_id AND r.local_file_id=f.id WHERE d.id=? AND d.store_id=? AND d.source_type='WASTE_RECEIPT' AND d.deleted_at IS NULL AND r.deleted_at IS NULL AND f.retention_status='RETAINED' AND f.mime_type IN ('image/jpeg','image/png','image/heic','image/heif','application/vnd.flcopilot.receipt+json') LIMIT 2",
                sourceDocumentId,
                this.scope.storeId,
              )
            : kind === "STORE_PHOTO"
              ? await tx.getAllAsync<{ id: string; mime_type: string }>(
                  "SELECT f.id,f.mime_type FROM local_files f JOIN source_documents d ON d.id=f.source_document_id AND d.store_id=f.store_id AND d.checksum=f.checksum WHERE d.id=? AND d.store_id=? AND d.source_type='STORE_PHOTO' AND d.deleted_at IS NULL AND f.retention_status='RETAINED' AND f.local_uri=d.local_file_uri AND f.mime_type IN ('image/jpeg','image/png','image/heic','image/heif') AND EXISTS (SELECT 1 FROM local_jobs j WHERE j.type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(j.payload_json,'$.sourceDocumentId')=d.id AND json_extract(j.payload_json,'$.ownerId')=?) LIMIT 2",
                  sourceDocumentId,
                  this.scope.storeId,
                  this.scope.ownerId,
                )
              : await tx.getAllAsync<{ id: string; mime_type: string }>(
                  "SELECT id,mime_type FROM local_files WHERE source_document_id=? AND store_id=? AND mime_type='application/pdf' AND retention_status='RETAINED' LIMIT 2",
                  sourceDocumentId,
                  this.scope.storeId,
                );
        const file = files.length === 1 ? files[0] : null;
        if (!source || !file)
          throw Error("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
        if (file.mime_type === RECEIPT_PHOTO_BUNDLE_MIME) {
          const group = await readReceiptPhotoViews(
            tx,
            this.scope.storeId,
            sourceDocumentId,
          );
          if (!group?.grouped || group.views.length < 2)
            throw Error("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
        }
        if (!attachments.some((a) => a.sourceDocumentId === sourceDocumentId))
          attachments.push({
            sourceDocumentId,
            filename: source.original_filename,
            mediaType: file.mime_type,
          });
      }
      if (kind === "STORE_PHOTO") {
        let photos = 0;
        for (const a of attachments) {
          const photo = await tx.getFirstAsync(
            "SELECT id FROM source_documents WHERE id=? AND store_id=? AND source_type='STORE_PHOTO' AND deleted_at IS NULL",
            a.sourceDocumentId,
            this.scope.storeId,
          );
          if (photo) photos++;
        }
        if (photos > MAX_STORE_PHOTOS_PER_TURN)
          throw Error("STORE_PHOTO_TURN_LIMIT");
      }
      result = copilotDraftSchema.parse({ ...draft, updatedAt, attachments });
      cancelled();
      await tx.runAsync(
        "INSERT OR REPLACE INTO copilot_drafts(store_id,owner_id,conversation_id,payload_json) VALUES(?,?,?,?)",
        this.scope.storeId,
        this.scope.ownerId,
        conversationId,
        JSON.stringify(result),
      );
      cancelled();
    });
    return result!;
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
