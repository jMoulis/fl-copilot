import { copilotMessageContent } from "@fl-copilot/domain";
import {
  actionExecutionSchema,
  sameActionExecutionIdentity,
  readActionExecutionProposal,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  commercialExecutionActualsNotFuture,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
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
    throw Error("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
}
export async function applyActionExecutionRecord(
  db: OutboxDatabase,
  scope: Scope,
  payload: unknown,
  ackVersion?: number,
) {
  const e = actionExecutionSchema.parse(payload);
  scoped(e, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM action_executions WHERE id=?",
    e.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (
      !sameActionExecutionIdentity(
        actionExecutionSchema.parse(JSON.parse(old.payload_json)),
        e,
      )
    )
      throw Error("COPILOT_ACTION_EXECUTION_IDENTITY_INVALID");
  }
  if (
    old?.dirty &&
    (ackVersion === undefined ||
      JSON.parse(old.payload_json).version !== ackVersion)
  ) {
    if ((old.remote_version ?? 0) <= e.version)
      await db.runAsync(
        "UPDATE action_executions SET remote_payload_json=?,remote_version=? WHERE id=?",
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO action_executions(id,store_id,owner_id,conversation_id,recommendation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    e.conversationId,
    e.recommendationId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export class CopilotActionExecutionRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope & { deviceId: string; canRecord: boolean },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content } = readActionExecutionProposal(raw);
    scoped(message, this.scope);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM action_executions WHERE id=?",
      message.id,
    );
    const link = row
      ? actionExecutionSchema.parse(JSON.parse(row.payload_json))
      : null;
    if (link) {
      scoped(link, this.scope);
      if (
        JSON.stringify(link.snapshot) !== JSON.stringify(content.snapshot) ||
        link.proposalMessageId !== message.id ||
        link.recommendationId !== content.recommendationId ||
        link.conversationId !== message.conversationId
      )
        throw Error("COPILOT_ACTION_EXECUTION_IDENTITY_INVALID");
    }
    let status: "READY" | "STALE" | "CONFIRMED" | "WITHDRAWN" | "ERROR" = link
      ? row?.sync_state === "ERROR" || row?.sync_state === "CONFLICT"
        ? "ERROR"
        : link.version === 2
          ? "WITHDRAWN"
          : "CONFIRMED"
      : "READY";
    let proof: unknown = null;
    if (!link) {
      const basis = content.snapshot.basis;
      const sourceRow = await this.db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
        basis.sourceMessageId,
        this.scope.storeId,
        this.scope.ownerId,
        message.conversationId,
      );
      const source = sourceRow
        ? copilotMessageSchema.parse(JSON.parse(sourceRow.payload_json))
        : null;
      const topicRow = await this.db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
        message.conversationId,
        this.scope.storeId,
        this.scope.ownerId,
      );
      const topic = topicRow
        ? copilotConversationSchema.parse(JSON.parse(topicRow.payload_json))
        : null;
      const count = await this.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM action_executions WHERE store_id=? AND owner_id=?",
        this.scope.storeId,
        this.scope.ownerId,
      );
      if ((count?.n ?? 0) >= 500) status = "ERROR";
      else if (
        !topic ||
        topic.deletedMessageIds?.includes(basis.sourceMessageId) ||
        recommendationIdFromDigest(
          await this.digest(
            recommendationTrackingIdentityPayload(message, basis),
          ),
        ) !== content.recommendationId ||
        (source &&
          (source.role !== "ASSISTANT" ||
            source.id !== basis.sourceMessageId ||
            source.createdAt !== basis.sourceCreatedAt ||
            !source.text.includes(basis.quote) ||
            (await this.digest(
              JSON.stringify(copilotMessageContent(source)),
            )) !== basis.sourceDigest ||
            copilotMessageIsDeleted(source, topic)))
      )
        status = "STALE";
      proof = [sourceRow, topicRow, count];
    }
    return {
      message,
      content,
      link,
      status,
      syncState: row?.sync_state ?? null,
      review: await this.digest(JSON.stringify([message, row, proof])),
    };
  }
  async save(
    message: CopilotMessage,
    review: string,
    withdraw = false,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canRecord || signal?.aborted)
      throw Error("COPILOT_ACTION_EXECUTION_FORBIDDEN");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const repo = new CopilotActionExecutionRepository(
          joinedProductToolDatabase(tx),
          this.scope,
          this.digest,
          this.id,
          this.now,
        ),
        state = await repo.open(message);
      if (state.review !== review)
        throw Error("COPILOT_ACTION_EXECUTION_REVIEW_REQUIRED");
      if ((!withdraw && state.link) || (withdraw && state.link?.version === 2))
        return;
      if (withdraw ? state.status !== "CONFIRMED" : state.status !== "READY")
        throw Error("COPILOT_ACTION_EXECUTION_REVIEW_REQUIRED");
      const now = this.now();
      const e = actionExecutionSchema.parse(
        withdraw
          ? { ...state.link, version: 2, withdrawnAt: now, status: "WITHDRAWN" }
          : {
              id: message.id,
              storeId: this.scope.storeId,
              ownerId: this.scope.ownerId,
              conversationId: message.conversationId,
              proposalMessageId: message.id,
              snapshot: state.content.snapshot,
              recommendationId: state.content.recommendationId,
              decisionId: null,
              actionType: "USER_DECLARED",
              plannedStart: null,
              plannedEnd: null,
              status: "DECLARED_DONE",
              createdAt: now,
              withdrawnAt: null,
              version: 1,
            },
      );
      if (!commercialExecutionActualsNotFuture(e.snapshot.actuals, now))
        throw Error("COPILOT_ACTION_EXECUTION_DATE_INVALID");
      if (now < message.createdAt)
        throw Error("COPILOT_ACTION_EXECUTION_DATE_INVALID");
      await tx.runAsync(
        "INSERT INTO action_executions(id,store_id,owner_id,conversation_id,recommendation_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        e.conversationId,
        e.recommendationId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: this.id(),
        deviceId: this.scope.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_ACTION_EXECUTION_UPSERT",
        entityType: "copilot_action_execution",
        entityId: e.id,
        expectedRemoteVersion: withdraw ? 1 : null,
        payload: e,
        createdAt: now,
      });
      if (signal?.aborted) throw Error("COPILOT_ACTION_EXECUTION_CANCELLED");
    });
    return this.open(message);
  }
}
