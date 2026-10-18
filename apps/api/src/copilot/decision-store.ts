import { createHash } from "node:crypto";
import {
  recommendationDecisionSchema,
  sameRecommendationDecisionIdentity,
  readRecommendationTrackingCard,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  storeEventTimeParts,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
  type RecommendationDecision,
} from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import { recommendationSourceDigest } from "./recommendation-tracking-tool.js";
export type DecisionDocument = RecommendationDecision & { _id: string };
export function serializeDecision(row: DecisionDocument) {
  const { _id, ...p } = row;
  const e = recommendationDecisionSchema.parse(p);
  if (e.id !== _id) throw Error("COPILOT_DECISION_IDENTITY_INVALID");
  return e;
}
export async function canAccessDecision(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  const p = recommendationDecisionSchema.safeParse(c.payload);
  if (
    !ownerId ||
    !p.success ||
    c.type !== "COPILOT_DECISION_UPSERT" ||
    c.entityType !== "copilot_decision" ||
    p.data.id !== c.entityId ||
    p.data.ownerId !== ownerId ||
    p.data.storeId !== storeId
  )
    return false;
  const old = await db
    .collection<DecisionDocument>("copilotDecisions")
    .findOne({ _id: c.entityId });
  return !old || (old.storeId === storeId && old.ownerId === ownerId);
}
export async function applyDecision(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string,
  c: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Cette décision doit être vérifiée dans sa conversation d’origine.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessDecision(ctx.database, storeId, ownerId, c)))
    return reject("COPILOT_DECISION_SCOPE_INVALID");
  const e = recommendationDecisionSchema.parse(c.payload),
    col = ctx.database.collection<DecisionDocument>("copilotDecisions"),
    old = await col.findOne({ _id: e.id }, { session: ctx.session });
  if ((c.expectedRemoteVersion ?? null) !== (old?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: old?.version ?? null,
      responseJson: {
        ...(old ? { remoteEntity: serializeDecision(old) } : {}),
        error: {
          code: "COPILOT_DECISION_CONFLICT",
          messageFr:
            "Un autre appareil a enregistré un choix différent. Comparez les décisions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    e.version !== (old?.version ?? 0) + 1 ||
    (old &&
      (!sameRecommendationDecisionIdentity(old, e) ||
        JSON.stringify(e.revisions.slice(0, -1)) !==
          JSON.stringify(old.revisions)))
  )
    return reject("COPILOT_DECISION_REVISION_INVALID");
  const scope = { storeId, ownerId, conversationId: e.conversationId };
  const cardRow = await ctx.database
    .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
    .findOne(
      { _id: e.revisions.at(-1)!.proposalMessageId, ...scope },
      { session: ctx.session },
    );
  if (!cardRow) return reject("COPILOT_DECISION_SOURCE_UNAVAILABLE");
  const { message: card, content } = readRecommendationTrackingCard(
    (({ _id, ...p }) => {
      void _id;
      return p;
    })(cardRow),
  );
  const sourceRow = await ctx.database
    .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
    .findOne(
      { _id: content.basis.sourceMessageId, ...scope },
      { session: ctx.session },
    );
  const topicRow = await ctx.database
    .collection<{ _id: string; [key: string]: unknown }>("copilotConversations")
    .findOne(
      { _id: e.conversationId, storeId, ownerId },
      { session: ctx.session },
    );
  if (!sourceRow || !topicRow)
    return reject("COPILOT_DECISION_SOURCE_UNAVAILABLE");
  const source = copilotMessageSchema.parse(
      (({ _id, ...p }) => {
        void _id;
        return p;
      })(sourceRow),
    ),
    topic = copilotConversationSchema.parse(
      (({ _id, ...p }) => {
        void _id;
        return p;
      })(topicRow),
    );
  if (
    source.role !== "ASSISTANT" ||
    source.id !== content.basis.sourceMessageId ||
    source.createdAt !== content.basis.sourceCreatedAt ||
    !source.text.includes(content.basis.quote) ||
    recommendationSourceDigest(source) !== content.basis.sourceDigest ||
    createHash("sha256")
      .update(recommendationTrackingIdentityPayload(card, content.basis))
      .digest("hex") !== e.proposalDigest ||
    recommendationIdFromDigest(e.proposalDigest) !== e.recommendationId ||
    content.recommendationId !== e.id ||
    topic.status !== "ACTIVE" ||
    copilotMessageIsDeleted(source, topic) ||
    copilotMessageIsDeleted(card, topic) ||
    e.createdAt !== content.basis.sourceCreatedAt ||
    e.updatedAt < card.createdAt
  )
    return reject("COPILOT_DECISION_SOURCE_CHANGED");
  const latest = e.revisions.at(-1)!;
  if (
    latest.postponeUntil &&
    latest.postponeUntil < storeEventTimeParts(latest.decidedAt).date
  )
    return reject("COPILOT_DECISION_DATE_INVALID");
  if (!old) {
    const counters = ctx.database.collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        count: number;
      }>("copilotDecisionCounters"),
      key = `${storeId}:${ownerId}`;
    const counter = await counters.findOne(
      { _id: key },
      { session: ctx.session },
    );
    if (!counter) {
      const count = await col.countDocuments(
        { storeId, ownerId },
        { session: ctx.session, limit: 500 },
      );
      await counters.updateOne(
        { _id: key },
        { $setOnInsert: { storeId, ownerId, count } },
        { upsert: true, session: ctx.session },
      );
    }
    const reserved = await counters.updateOne(
      { _id: key, storeId, ownerId, count: { $lt: 500 } },
      { $inc: { count: 1 } },
      { session: ctx.session },
    );
    if (!reserved.matchedCount) return reject("COPILOT_DECISION_LIMIT");
  }
  await col.replaceOne({ _id: e.id, storeId, ownerId }, e, {
    upsert: true,
    session: ctx.session,
  });
  await changes.append(ctx, {
    storeId,
    entityType: "copilot_decision",
    entityId: e.id,
    entityVersion: e.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: e.version,
    responseJson: { remoteEntity: e },
  };
}
