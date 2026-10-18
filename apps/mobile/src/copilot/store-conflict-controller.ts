import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotMessageIsDeleted,
  readStoreConflictProposal,
  storeConflictRequestSchema,
  storeConflictResultSchema,
  storeConflictAuthoritySchema,
  storeConflictDecisionSchema,
  type StoreConflictAuthority,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { StoreContextRepository } from "../store/context-repository";
import {
  joinedProductToolDatabase,
  runReviewedStoreOperation,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
import {
  readStoreConflictCurrent,
  readStoreConflictReview,
} from "./store-conflict-review";
type Scope = Pick<
  StoreConflictAuthority,
  | "storeId"
  | "ownerId"
  | "deviceId"
  | "canCaptureStoreEvents"
  | "canManageStoreSettings"
>;
function allowed(scope: Scope, kind: "FIELD_EVENT" | "SETTINGS") {
  return kind === "FIELD_EVENT"
    ? scope.canCaptureStoreEvents
    : scope.canManageStoreSettings;
}
async function proof(
  db: OutboxDatabase,
  scope: {
    storeId: string;
    ownerId: string;
    conversationId: string;
    userMessageId: string;
  },
  id: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    id,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) throw Error("STORE_CONFLICT_REVIEW_REQUIRED");
  const artifact = readStoreConflictProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  if (artifact.message.replyToMessageId !== scope.userMessageId)
    throw Error("STORE_CONFLICT_SCOPE");
  const parent = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    scope.userMessageId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  const topic = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
    scope.conversationId,
    scope.storeId,
    scope.ownerId,
  );
  const user = parent
    ? copilotMessageSchema.parse(JSON.parse(parent.payload_json))
    : null;
  if (
    !user ||
    user.role !== "USER" ||
    !topic ||
    copilotMessageIsDeleted(
      user,
      copilotConversationSchema.parse(JSON.parse(topic.payload_json)),
    )
  )
    throw Error("STORE_CONFLICT_PARENT_INVALID");
  return artifact;
}
export class CopilotStoreConflictRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: StoreConflictAuthority,
    signal?: AbortSignal,
  ) {
    const request = storeConflictRequestSchema.parse(raw),
      authority = storeConflictAuthoritySchema.parse(rawAuthority);
    if (!authority.comparisonReviewed || !allowed(authority, request.kind))
      throw Error("STORE_CONFLICT_FORBIDDEN");
    const {
      canCaptureStoreEvents,
      canManageStoreSettings,
      comparisonReviewed,
      ...scope
    } = authority;
    void canCaptureStoreEvents;
    void canManageStoreSettings;
    void comparisonReviewed;
    const initial = await proof(this.db, scope, request.operationId);
    if (
      initial.content.input.kind !== request.kind ||
      initial.content.basis.entityId !== request.entityId
    )
      throw Error("STORE_CONFLICT_SCOPE");
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: true },
      storeConflictResultSchema,
      async (tx, ctx) => {
        const { content } = await proof(tx, ctx, request.operationId),
          review = await readStoreConflictReview(tx, content, this.digest);
        if (
          review.status !== "READY" ||
          review.conflict?.id !== request.conflictId ||
          review.basisHash !== request.basisHash ||
          (request.decision === "KEEP_LOCAL"
            ? !review.canKeepLocal
            : !review.canAdoptRemote)
        )
          throw Error("STORE_CONFLICT_STALE");
        const joined = joinedProductToolDatabase(tx),
          commandId = this.id(),
          appliedAt = this.now(),
          useLocal = request.decision === "KEEP_LOCAL";
        if (request.kind === "FIELD_EVENT")
          await new StoreProductEventRepository(joined).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId, capturedAt: appliedAt },
          );
        else
          await new StoreContextRepository(joined).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        const after = await readStoreConflictCurrent(tx, content);
        if (!after || !["PENDING", "SYNCED"].includes(after.syncState))
          throw Error("STORE_CONFLICT_RESULT_INVALID");
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt,
          commandId,
          beforeVersion: review.current.entity.version,
          afterVersion: after.entity.version,
          syncState: after.syncState as "PENDING" | "SYNCED",
        };
      },
      signal,
    );
  }
}
export class CopilotStoreConflictController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const artifact = readStoreConflictProposal(raw),
      { message, content } = artifact;
    if (!allowed(this.scope, content.input.kind))
      throw Error("STORE_CONFLICT_FORBIDDEN");
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    await proof(
      this.db,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
      },
      message.id,
    );
    const row = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (row) {
      const result = storeConflictResultSchema.parse(
          JSON.parse(row.result_json),
        ),
        request = storeConflictRequestSchema.parse(
          JSON.parse(row.request_json),
        );
      if (
        row.store_id !== message.storeId ||
        row.owner_id !== message.ownerId ||
        row.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.entityId !== content.basis.entityId ||
        result.kind !== content.input.kind ||
        JSON.stringify(request) !==
          JSON.stringify({
            operationId: result.operationId,
            conflictId: result.conflictId,
            entityId: result.entityId,
            kind: result.kind,
            basisHash: result.basisHash,
            decision: result.decision,
          })
      )
        throw Error("STORE_CONFLICT_SCOPE");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        review: null,
        result,
      };
    }
    const review = await readStoreConflictReview(this.db, content, this.digest);
    return { ...artifact, status: review.status, review, result: null };
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    rawDecision: unknown,
    reviewed: boolean,
    signal?: AbortSignal,
  ) {
    const decision = storeConflictDecisionSchema.parse(rawDecision),
      state = await this.open(message);
    if (!reviewed) throw Error("STORE_CONFLICT_REVIEW_REQUIRED");
    if (state.status === "COMPLETED") {
      if (state.result.decision !== decision)
        throw Error("STORE_CONFLICT_DECISION_CHANGED");
      return state;
    }
    if (
      state.status !== "READY" ||
      state.review?.basisHash !== basisHash ||
      !state.review.conflict
    )
      throw Error("STORE_CONFLICT_STALE");
    const request = storeConflictRequestSchema.parse({
      operationId: message.id,
      conflictId: state.review.conflict.id,
      entityId: state.content.basis.entityId,
      kind: state.content.input.kind,
      basisHash,
      decision,
    });
    await new CopilotStoreConflictRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      request,
      {
        ...this.scope,
        comparisonReviewed: true,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: JSON.stringify(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
