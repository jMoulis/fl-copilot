import { copilotMessageContent } from "@fl-copilot/domain";
import {
  recommendationDecisionSchema,
  recommendationChoiceSchema,
  sameRecommendationDecisionIdentity,
  readRecommendationTrackingCard,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  storeEventTimeParts,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
  type CopilotMessage,
  type RecommendationDecision,
  type RecommendationChoice,
} from "@fl-copilot/domain";

import { joinedProductToolDatabase } from "./product-tool-transaction";
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
const scoped = (e: Scope, s: Scope) => {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("COPILOT_DECISION_SCOPE_INVALID");
};
export const decisionChoice = (
  v: RecommendationDecision["revisions"][number],
): RecommendationChoice =>
  recommendationChoiceSchema.parse({
    type: v.type,
    modifiedAction: v.modifiedAction,
    postponeUntil: v.postponeUntil,
    reason: v.reason,
  });
export async function applyDecisionRecord(
  db: OutboxDatabase,
  scope: Scope,
  payload: unknown,
  ackVersion?: number,
) {
  const e = recommendationDecisionSchema.parse(payload);
  scoped(e, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_decisions WHERE id=?",
    e.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (
      !sameRecommendationDecisionIdentity(
        recommendationDecisionSchema.parse(JSON.parse(old.payload_json)),
        e,
      )
    )
      throw Error("COPILOT_DECISION_IDENTITY_INVALID");
  }
  if (
    old?.dirty &&
    (ackVersion === undefined ||
      JSON.parse(old.payload_json).version !== ackVersion)
  ) {
    if ((old.remote_version ?? 0) <= e.version)
      await db.runAsync(
        "UPDATE copilot_decisions SET remote_payload_json=?,remote_version=? WHERE id=?",
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO copilot_decisions(id,store_id,owner_id,conversation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    e.conversationId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export class CopilotDecisionRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope & { deviceId: string; canDecide: boolean },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content } = readRecommendationTrackingCard(raw);
    scoped(message, this.scope);
    const persisted = await this.db.getFirstAsync<{
      payload_json: string;
      sync_state: string;
    }>(
      "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
      message.id,
      this.scope.storeId,
      this.scope.ownerId,
    );
    const parent = await this.db.getFirstAsync<{
      payload_json: string;
      sync_state: string;
    }>(
      "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
      content.assistantMessageId,
      this.scope.storeId,
      this.scope.ownerId,
    );
    const topicRow = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
      message.conversationId,
      this.scope.storeId,
      this.scope.ownerId,
    );
    const topic = topicRow
        ? copilotConversationSchema.parse(JSON.parse(topicRow.payload_json))
        : null,
      parentMessage = parent
        ? copilotMessageSchema.parse(JSON.parse(parent.payload_json))
        : null;
    if (
      !persisted ||
      persisted.sync_state !== "SYNCED" ||
      JSON.stringify(
        copilotMessageSchema.parse(JSON.parse(persisted.payload_json)),
      ) !== JSON.stringify(message) ||
      !parentMessage ||
      parent?.sync_state !== "SYNCED" ||
      parentMessage.role !== "ASSISTANT" ||
      parentMessage.id !== content.assistantMessageId ||
      parentMessage.createdAt > message.createdAt ||
      parentMessage.conversationId !== message.conversationId ||
      parentMessage.replyToMessageId !== message.replyToMessageId ||
      !topic ||
      topic.id !== message.conversationId
    )
      throw Error("COPILOT_DECISION_SOURCE_UNAVAILABLE");
    scoped(parentMessage, this.scope);
    scoped(topic, this.scope);
    const source = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      content.basis.sourceMessageId,
      this.scope.storeId,
      this.scope.ownerId,
      message.conversationId,
    );
    const sourceMessage = source
      ? copilotMessageSchema.parse(JSON.parse(source.payload_json))
      : null;
    const sourceCurrent =
      topic.status === "ACTIVE" &&
      !copilotMessageIsDeleted(message, topic) &&
      !copilotMessageIsDeleted(parentMessage, topic) &&
      !(topic.deletedMessageIds ?? []).includes(
        content.basis.sourceMessageId,
      ) &&
      (!sourceMessage ||
        (!copilotMessageIsDeleted(sourceMessage, topic) &&
          sourceMessage.role === "ASSISTANT" &&
          sourceMessage.id === content.basis.sourceMessageId &&
          sourceMessage.createdAt === content.basis.sourceCreatedAt &&
          sourceMessage.text.includes(content.basis.quote) &&
          (await this.digest(
            JSON.stringify(copilotMessageContent(sourceMessage)),
          )) === content.basis.sourceDigest));
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM copilot_decisions WHERE id=?",
      content.recommendationId,
    );
    if (row)
      scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
    const decision = row
        ? recommendationDecisionSchema.parse(JSON.parse(row.payload_json))
        : null,
      remote = row?.remote_payload_json
        ? recommendationDecisionSchema.parse(
            JSON.parse(row.remote_payload_json),
          )
        : null;
    const proposalDigest = await this.digest(
      recommendationTrackingIdentityPayload(message, content.basis),
    );
    if (recommendationIdFromDigest(proposalDigest) !== content.recommendationId)
      throw Error("COPILOT_DECISION_IDENTITY_INVALID");
    if (
      decision &&
      (decision.proposalDigest !== proposalDigest ||
        decision.recommendationId !== content.recommendationId ||
        decision.conversationId !== message.conversationId)
    )
      throw Error("COPILOT_DECISION_IDENTITY_INVALID");
    if (
      remote &&
      (!decision || !sameRecommendationDecisionIdentity(decision, remote))
    )
      throw Error("COPILOT_DECISION_IDENTITY_INVALID");
    const conflicts = await this.db.getAllAsync<{
      id: string;
      local_payload_json: string;
      remote_payload_json: string;
    }>(
      "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts WHERE store_id=? AND entity_type='copilot_decision' AND entity_id=? AND status='OPEN' ORDER BY id LIMIT 2",
      this.scope.storeId,
      content.recommendationId,
    );
    const count = row
      ? 0
      : ((
          await this.db.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) AS n FROM copilot_decisions WHERE store_id=? AND owner_id=?",
            this.scope.storeId,
            this.scope.ownerId,
          )
        )?.n ?? 0);
    const review = await this.digest(
      JSON.stringify([message, sourceMessage, row, conflicts]),
    );
    const localDate = decision?.revisions.at(-1)?.postponeUntil;
    const retentionIssue = !sourceCurrent
      ? "SOURCE_UNAVAILABLE"
      : localDate && localDate < storeEventTimeParts(this.now()).date
        ? "POSTPONE_DATE_PASSED"
        : remote && remote.version >= 50
          ? "HISTORY_LIMIT"
          : null;
    return {
      message,
      content,
      decision,
      remote,
      proposalDigest,
      review,
      syncState: row?.sync_state ?? null,
      sourceLocallyAvailable: !!sourceMessage,
      hasCapacity: !!row || count < 500,
      retentionIssue,
      canRetainLocal: retentionIssue === null,
      status:
        row?.sync_state === "CONFLICT"
          ? ("CONFLICT" as const)
          : !sourceCurrent
            ? ("SOURCE_UNAVAILABLE" as const)
            : row?.sync_state === "ERROR"
              ? ("ERROR" as const)
              : ("READY" as const),
      canResolve: conflicts.length === 1 && !!remote,
    };
  }
  async save(
    message: CopilotMessage,
    raw: RecommendationChoice,
    review: string,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canDecide || signal?.aborted)
      throw Error("COPILOT_DECISION_FORBIDDEN");
    const choice = recommendationChoiceSchema.parse(raw);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const db = joinedProductToolDatabase(tx),
        repo = new CopilotDecisionRepository(
          db,
          this.scope,
          this.digest,
          this.id,
          this.now,
        ),
        state = await repo.open(message);
      if (!state.hasCapacity) throw Error("COPILOT_DECISION_LIMIT");
      if (state.review !== review || state.status !== "READY")
        throw Error("COPILOT_DECISION_REVIEW_REQUIRED");
      if (
        state.decision &&
        state.decision.revisions.at(-1)!.proposalMessageId === message.id &&
        JSON.stringify(decisionChoice(state.decision.revisions.at(-1)!)) ===
          JSON.stringify(choice)
      )
        return;
      const now = this.now();
      if (
        choice.postponeUntil &&
        choice.postponeUntil < storeEventTimeParts(now).date
      )
        throw Error("COPILOT_DECISION_DATE_INVALID");
      const e = recommendationDecisionSchema.parse({
        id: state.content.recommendationId,
        storeId: this.scope.storeId,
        ownerId: this.scope.ownerId,
        conversationId: message.conversationId,
        recommendationId: state.content.recommendationId,
        proposalDigest: state.proposalDigest,
        version: (state.decision?.version ?? 0) + 1,
        createdAt:
          state.decision?.createdAt ?? state.content.basis.sourceCreatedAt,
        updatedAt: now,
        revisions: [
          ...(state.decision?.revisions ?? []),
          {
            ...choice,
            proposalMessageId: message.id,
            version: (state.decision?.version ?? 0) + 1,
            decidedAt: now,
          },
        ],
      });
      if (now < message.createdAt) throw Error("COPILOT_DECISION_DATE_INVALID");
      await tx.runAsync(
        "INSERT INTO copilot_decisions(id,store_id,owner_id,conversation_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        e.conversationId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: this.id(),
        deviceId: this.scope.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_DECISION_UPSERT",
        entityType: "copilot_decision",
        entityId: e.id,
        expectedRemoteVersion: state.decision?.version ?? null,
        payload: e,
        createdAt: now,
      });
      if (signal?.aborted) throw Error("COPILOT_DECISION_CANCELLED");
    });
    return this.open(message);
  }
  async resolve(
    message: CopilotMessage,
    useLocal: boolean,
    review: string,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canDecide || signal?.aborted)
      throw Error("COPILOT_DECISION_FORBIDDEN");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const db = joinedProductToolDatabase(tx),
        state = await new CopilotDecisionRepository(
          db,
          this.scope,
          this.digest,
          this.id,
          this.now,
        ).open(message);
      if (
        state.review !== review ||
        state.status !== "CONFLICT" ||
        !state.canResolve ||
        !state.decision ||
        !state.remote
      )
        throw Error("COPILOT_DECISION_REVIEW_REQUIRED");
      const commands = await tx.getAllAsync<{ status: string }>(
        "SELECT status FROM sync_outbox WHERE store_id=? AND entity_type='copilot_decision' AND entity_id=? ORDER BY local_sequence LIMIT 101",
        this.scope.storeId,
        state.content.recommendationId,
      );
      if (useLocal && !state.canRetainLocal)
        throw Error("COPILOT_DECISION_SOURCE_UNAVAILABLE");
      if (commands.length > 100 || commands.some((c) => c.status === "SYNCING"))
        throw Error("COPILOT_DECISION_SYNCING");
      const now = this.now(),
        remote = state.remote;
      const resolved = useLocal
        ? recommendationDecisionSchema.parse({
            ...remote,
            version: remote.version + 1,
            updatedAt: now,
            revisions: [
              ...remote.revisions,
              {
                ...decisionChoice(state.decision.revisions.at(-1)!),
                proposalMessageId: message.id,
                version: remote.version + 1,
                decidedAt: now,
              },
            ],
          })
        : remote;
      if (
        useLocal &&
        resolved.revisions.at(-1)!.postponeUntil &&
        resolved.revisions.at(-1)!.postponeUntil! <
          storeEventTimeParts(now).date
      )
        throw Error("COPILOT_DECISION_DATE_INVALID");
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='COPILOT_DECISION_SUPERSEDED' WHERE store_id=? AND entity_type='copilot_decision' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        this.scope.storeId,
        state.content.recommendationId,
      );
      await tx.runAsync(
        "UPDATE copilot_decisions SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        state.content.recommendationId,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='copilot_decision' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        this.scope.storeId,
        state.content.recommendationId,
      );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: this.id(),
          deviceId: this.scope.deviceId,
          storeId: this.scope.storeId,
          commandType: "COPILOT_DECISION_UPSERT",
          entityType: "copilot_decision",
          entityId: state.content.recommendationId,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (signal?.aborted) throw Error("COPILOT_DECISION_CANCELLED");
    });
    return this.open(message);
  }
}
