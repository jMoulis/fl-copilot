import { legacyCommercialExecution } from "@fl-copilot/domain";
import type { Db, ClientSession } from "mongodb";
import { createHash } from "node:crypto";
import {
  serializeCommercialPlanRevision,
  type PlanRevisionDocument,
} from "../commercial/week-plan-sync";
import {
  copilotExecutionLinkSchema,
  sameExecutionLinkIdentity,
  readExecutionLinkProposal,
  recommendationDecisionSchema,
  readRecommendationTrackingCard,
  commercialExecutionTaskSchema,
  recommendationTrackingIdentityPayload,
  type CopilotExecutionLink,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
export type ExecutionLinkDocument = CopilotExecutionLink & { _id: string };
export function serializeExecutionLink(row: ExecutionLinkDocument) {
  const { _id, ...p } = row;
  const e = copilotExecutionLinkSchema.parse(p);
  if (e.id !== _id) throw Error("COPILOT_EXECUTION_LINK_SCOPE_INVALID");
  return e;
}
export async function canAccessExecutionLink(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  const p = copilotExecutionLinkSchema.safeParse(c.payload);
  if (
    !ownerId ||
    !p.success ||
    c.type !== "COPILOT_EXECUTION_LINK_UPSERT" ||
    c.entityType !== "copilot_execution_link" ||
    p.data.id !== c.entityId ||
    p.data.storeId !== storeId ||
    p.data.ownerId !== ownerId
  )
    return false;
  const old = await db
    .collection<ExecutionLinkDocument>("copilotExecutionLinks")
    .findOne({ _id: c.entityId });
  return (
    !old ||
    (old.storeId === storeId &&
      old.ownerId === ownerId &&
      sameExecutionLinkIdentity(serializeExecutionLink(old), p.data))
  );
}
const messagePayload = (row: { _id: unknown; [key: string]: unknown }) => {
  const { _id, ...p } = row;
  void _id;
  return p;
};
/** Verify the exact historical choice and declaration; later revisions cannot rewrite a link. */
export async function validateExecutionLinkSnapshot(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
  session?: ClientSession,
) {
  const { content } = readExecutionLinkProposal(raw),
    s = content.snapshot,
    options = session ? { session } : {};
  const decisionRow = await db
    .collection<{ _id: string; [key: string]: unknown }>("copilotDecisions")
    .findOne({ _id: s.decision.id, ...scope }, options);
  if (!decisionRow) throw Error("COPILOT_EXECUTION_LINK_DECISION_UNAVAILABLE");
  const d = recommendationDecisionSchema.parse(messagePayload(decisionRow));
  const revision = d.revisions[s.decision.version - 1];
  if (
    d.id !== decisionRow._id ||
    d.storeId !== scope.storeId ||
    d.ownerId !== scope.ownerId ||
    d.conversationId !== s.decision.conversationId ||
    JSON.stringify(revision) !== JSON.stringify(s.decision.revision)
  )
    throw Error("COPILOT_EXECUTION_LINK_DECISION_CHANGED");
  const sourceCard = await db
    .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
    .findOne(
      {
        _id: s.decision.revision.proposalMessageId,
        ...scope,
        conversationId: d.conversationId,
      },
      options,
    );
  if (!sourceCard) throw Error("COPILOT_EXECUTION_LINK_SOURCE_UNAVAILABLE");
  const tracked = readRecommendationTrackingCard(messagePayload(sourceCard));
  if (
    tracked.content.recommendationId !== d.id ||
    createHash("sha256")
      .update(recommendationTrackingIdentityPayload(d, s.decision.basis))
      .digest("hex") !== d.proposalDigest ||
    JSON.stringify(tracked.content.basis) !== JSON.stringify(s.decision.basis)
  )
    throw Error("COPILOT_EXECUTION_LINK_SOURCE_CHANGED");
  const planRow = await db
    .collection<PlanRevisionDocument>("commercialPlanRevisions")
    .findOne({ _id: s.task.planRevisionId, storeId: scope.storeId }, options);
  if (
    !planRow ||
    serializeCommercialPlanRevision(planRow).plan.weekStart !== s.weekStart
  )
    throw Error("COPILOT_EXECUTION_LINK_TASK_UNAVAILABLE");
  const taskRow = await db
    .collection<{ _id: string; [key: string]: unknown }>(
      "commercialExecutionTasks",
    )
    .findOne({ _id: s.task.id, storeId: scope.storeId }, options);
  const current = taskRow
    ? commercialExecutionTaskSchema.parse(messagePayload(taskRow))
    : null;
  if (
    current &&
    JSON.stringify(legacyCommercialExecution(current)) ===
      JSON.stringify(s.task)
  )
    return;
  const history = await db
    .collection("commercialExecutionHistory")
    .findOne(
      { storeId: scope.storeId, taskId: s.task.id, version: s.task.version },
      options,
    );
  if (
    !history ||
    JSON.stringify(
      legacyCommercialExecution(
        commercialExecutionTaskSchema.parse(history.plan),
      ),
    ) !== JSON.stringify(s.task)
  )
    throw Error("COPILOT_EXECUTION_LINK_TASK_UNAVAILABLE");
}
export async function applyExecutionLink(
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
          "L’association reste conservée sur cet appareil. Vérifiez le choix et la déclaration avant de la reprendre.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessExecutionLink(ctx.database, storeId, ownerId, c)))
    return reject("COPILOT_EXECUTION_LINK_SCOPE_INVALID");
  let e = copilotExecutionLinkSchema.parse(c.payload);
  const col = ctx.database.collection<ExecutionLinkDocument>(
      "copilotExecutionLinks",
    ),
    oldRow = await col.findOne({ _id: e.id }, { session: ctx.session }),
    old = oldRow ? serializeExecutionLink(oldRow) : null;
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
    return reject("COPILOT_EXECUTION_LINK_VERSION_INVALID");
  if (old) {
    if (e.withdrawnAt! < old.createdAt)
      return reject("COPILOT_EXECUTION_LINK_DATE_INVALID");
    e = copilotExecutionLinkSchema.parse({
      ...old,
      version: 2,
      withdrawnAt: e.withdrawnAt,
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
    if (!cardRow) return reject("COPILOT_EXECUTION_LINK_SOURCE_UNAVAILABLE");
    const card = readExecutionLinkProposal(messagePayload(cardRow));
    if (
      JSON.stringify(card.content.snapshot) !== JSON.stringify(e.snapshot) ||
      e.createdAt < card.message.createdAt
    )
      return reject("COPILOT_EXECUTION_LINK_SOURCE_CHANGED");
    try {
      await validateExecutionLinkSnapshot(
        ctx.database,
        { storeId, ownerId },
        card.message,
        ctx.session,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("COPILOT_EXECUTION_LINK_")
      )
        return reject("COPILOT_EXECUTION_LINK_PROOF_INVALID");
      throw error;
    }
    const counters = ctx.database.collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        count: number;
      }>("copilotExecutionLinkCounters"),
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
    if (!reserved.matchedCount) return reject("COPILOT_EXECUTION_LINK_LIMIT");
  }
  await col.replaceOne({ _id: e.id }, e, {
    upsert: true,
    session: ctx.session,
  });
  await changes.append(ctx, {
    storeId,
    entityType: "copilot_execution_link",
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
