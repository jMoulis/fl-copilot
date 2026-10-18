import { createHash } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import {
  actionExecutionSchema,
  sameActionExecutionIdentity,
  readActionExecutionProposal,
  copilotMessageSchema,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
  commercialExecutionActualsNotFuture,
  type ActionExecution,
  copilotConversationSchema,
  copilotMessageIsDeleted,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import { recommendationSourceDigest } from "./recommendation-tracking-tool";
export type ActionExecutionDocument = ActionExecution & { _id: string };
export function serializeActionExecution(row: ActionExecutionDocument) {
  const { _id, ...p } = row;
  const e = actionExecutionSchema.parse(p);
  if (e.id !== _id) throw Error("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
  return e;
}
export async function canAccessActionExecution(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  const p = actionExecutionSchema.safeParse(c.payload);
  if (
    !ownerId ||
    !p.success ||
    c.type !== "COPILOT_ACTION_EXECUTION_UPSERT" ||
    c.entityType !== "copilot_action_execution" ||
    p.data.id !== c.entityId ||
    p.data.storeId !== storeId ||
    p.data.ownerId !== ownerId
  )
    return false;
  const old = await db
    .collection<ActionExecutionDocument>("actionExecutions")
    .findOne({ _id: c.entityId });
  return (
    !old ||
    (old.storeId === storeId &&
      old.ownerId === ownerId &&
      sameActionExecutionIdentity(serializeActionExecution(old), p.data))
  );
}
const messagePayload = (row: { _id: unknown; [key: string]: unknown }) => {
  const { _id, ...p } = row;
  void _id;
  return p;
};
export async function validateActionExecutionSource(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
  session?: ClientSession,
  requireActive = false,
) {
  const target = { storeId: scope.storeId, ownerId: scope.ownerId };
  const { message, content } = readActionExecutionProposal(raw),
    b = content.snapshot.basis;
  if (message.storeId !== scope.storeId || message.ownerId !== scope.ownerId)
    throw Error("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
  const row = await db
    .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
    .findOne(
      {
        _id: b.sourceMessageId,
        ...target,
        conversationId: message.conversationId,
      },
      { ...(session ? { session } : {}), maxTimeMS: 2000 },
    );
  if (!row) throw Error("COPILOT_ACTION_EXECUTION_SOURCE_UNAVAILABLE");
  const source = copilotMessageSchema.parse(messagePayload(row));
  if (requireActive) {
    const t = await db
      .collection<{ _id: string; [key: string]: unknown }>(
        "copilotConversations",
      )
      .findOne(
        { _id: message.conversationId, ...target },
        session ? { session } : {},
      );
    if (!t) throw Error("COPILOT_ACTION_EXECUTION_SOURCE_UNAVAILABLE");
    const topic = copilotConversationSchema.parse(messagePayload(t));
    if (topic.status !== "ACTIVE" || copilotMessageIsDeleted(source, topic))
      throw Error("COPILOT_ACTION_EXECUTION_SOURCE_UNAVAILABLE");
  }
  if (
    source.id !== b.sourceMessageId ||
    source.role !== "ASSISTANT" ||
    source.storeId !== scope.storeId ||
    source.ownerId !== scope.ownerId ||
    source.conversationId !== message.conversationId ||
    source.createdAt !== b.sourceCreatedAt ||
    !source.text.includes(b.quote) ||
    recommendationSourceDigest(source) !== b.sourceDigest ||
    recommendationIdFromDigest(
      createHash("sha256")
        .update(recommendationTrackingIdentityPayload(message, b))
        .digest("hex"),
    ) !== content.recommendationId
  )
    throw Error("COPILOT_ACTION_EXECUTION_SOURCE_CHANGED");
}
export async function applyActionExecution(
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
          "La réalisation reste conservée sur cet appareil. Vérifiez la déclaration et son conseil d’origine avant de la reprendre.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessActionExecution(ctx.database, storeId, ownerId, c)))
    return reject("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
  let e = actionExecutionSchema.parse(c.payload);
  if (
    !commercialExecutionActualsNotFuture(e.snapshot.actuals, e.createdAt) ||
    !commercialExecutionActualsNotFuture(
      e.snapshot.actuals,
      new Date().toISOString(),
    )
  )
    return reject("COPILOT_ACTION_EXECUTION_DATE_INVALID");
  const col =
      ctx.database.collection<ActionExecutionDocument>("actionExecutions"),
    oldRow = await col.findOne({ _id: e.id }, { session: ctx.session }),
    old = oldRow ? serializeActionExecution(oldRow) : null;
  if (old && (old.version === 2 || e.version === 1))
    return {
      resultStatus: "APPLIED",
      resultingVersion: old.version,
      responseJson: { remoteEntity: old },
    };
  if (
    (!old && (e.version !== 1 || c.expectedRemoteVersion != null)) ||
    (old && (e.version !== 2 || c.expectedRemoteVersion !== 1))
  )
    return reject("COPILOT_ACTION_EXECUTION_VERSION_INVALID");
  if (old) {
    if (e.withdrawnAt! < old.createdAt)
      return reject("COPILOT_ACTION_EXECUTION_DATE_INVALID");
    e = actionExecutionSchema.parse({
      ...old,
      version: 2,
      withdrawnAt: e.withdrawnAt,
      status: "WITHDRAWN",
    });
  } else {
    const cardRow = await ctx.database
      .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
      .findOne(
        {
          _id: e.proposalMessageId,
          storeId,
          ownerId,
          conversationId: e.conversationId,
        },
        { session: ctx.session },
      );
    if (!cardRow) return reject("COPILOT_ACTION_EXECUTION_SOURCE_UNAVAILABLE");
    const card = readActionExecutionProposal(messagePayload(cardRow));
    if (
      JSON.stringify(card.content.snapshot) !== JSON.stringify(e.snapshot) ||
      card.content.recommendationId !== e.recommendationId ||
      e.createdAt < card.message.createdAt
    )
      return reject("COPILOT_ACTION_EXECUTION_SOURCE_CHANGED");
    try {
      await validateActionExecutionSource(
        ctx.database,
        { storeId, ownerId },
        card.message,
        ctx.session,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("COPILOT_ACTION_EXECUTION_")
      )
        return reject("COPILOT_ACTION_EXECUTION_PROOF_INVALID");
      throw error;
    }
    const counters = ctx.database.collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        count: number;
      }>("actionExecutionCounters"),
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
      { _id: key, count: { $lt: 500 } },
      { $inc: { count: 1 } },
      { session: ctx.session },
    );
    if (!reserved.matchedCount) return reject("COPILOT_ACTION_EXECUTION_LIMIT");
  }
  await col.replaceOne({ _id: e.id }, e, {
    upsert: true,
    session: ctx.session,
  });
  await changes.append(ctx, {
    storeId,
    entityType: "copilot_action_execution",
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
