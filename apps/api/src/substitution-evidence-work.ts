import { randomUUID } from "node:crypto";
import {
  substitutionEvidenceStateSchema,
  type SubstitutionEvidenceState,
} from "@fl-copilot/domain";
import type { MongoCommandMutationContext } from "./sync/processed-command-service";
import {
  createMongoSyncChangeService,
  type SyncChangeDocument,
} from "./sync/sync-change-service";
export type EvidenceWork = {
  _id: string;
  storeId: string;
  eventId: string;
  generation: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  leaseId: string | null;
  processedGeneration?: number;
  lastError?: string | null;
};
export type EvidenceStateDocument = SubstitutionEvidenceState & { _id: string };
export async function writeEvidenceState(
  ctx: MongoCommandMutationContext,
  input: Omit<SubstitutionEvidenceState, "version">,
) {
  const rows = ctx.database.collection<EvidenceStateDocument>(
      "substitutionEvidenceStates",
    ),
    old = await rows.findOne(
      { _id: input.id, storeId: input.storeId },
      { session: ctx.session },
    );
  if (
    old &&
    old.status === input.status &&
    JSON.stringify(old.reasons) === JSON.stringify(input.reasons) &&
    JSON.stringify(old.evidenceIds) === JSON.stringify(input.evidenceIds)
  )
    return;
  const value = substitutionEvidenceStateSchema.parse({
    ...input,
    version: (old?.version ?? 0) + 1,
  });
  await rows.replaceOne({ _id: input.id, storeId: input.storeId }, value, {
    upsert: true,
    session: ctx.session,
  });
  await createMongoSyncChangeService().append(ctx, {
    storeId: input.storeId,
    entityId: input.id,
    entityType: "substitution_evidence_state",
    entityVersion: value.version,
    operation: "UPSERT",
  });
}
const relevant = new Set([
  "store_product_event",
  "product_substitution",
  "need_unit",
  "need_membership",
  "product",
  "sales_observation",
  "commercial_week_plan",
  "commercial_execution_task",
  "store_context_settings",
  "commercial_version_decision",
  "commercial_validated_offer",
]);
export async function queueSubstitutionEvidence(
  ctx: MongoCommandMutationContext,
  change: SyncChangeDocument,
) {
  if (
    !relevant.has(change.entityType) ||
    (change.entityType === "product_substitution" &&
      change.payloadRevision === "substitution-score.v1")
  )
    return;
  const jobs = ctx.database.collection<EvidenceWork>(
      "substitutionEvidenceWork",
    ),
    eventChange = change.entityType === "store_product_event";
  if (eventChange) {
    await jobs.updateOne(
      { _id: change.entityId, storeId: change.storeId },
      {
        $inc: { generation: 1 },
        $set: { nextAttemptAt: change.changedAt },
        $setOnInsert: {
          storeId: change.storeId,
          eventId: change.entityId,
          leaseUntil: null,
          leaseId: null,
        },
      },
      { upsert: true, session: ctx.session },
    );
  }
  // A newly captured/closed incident may invalidate another incident's baseline.
  await jobs.updateMany(
    {
      storeId: change.storeId,
      ...(eventChange ? { _id: { $ne: change.entityId } } : {}),
    },
    { $inc: { generation: 1 }, $set: { nextAttemptAt: change.changedAt } },
    { session: ctx.session },
  );
  const scopes = await jobs
    .find({ storeId: change.storeId }, { session: ctx.session })
    .toArray();
  for (const scope of scopes) {
    const old = await ctx.database
      .collection<EvidenceStateDocument>("substitutionEvidenceStates")
      .findOne(
        { _id: scope.eventId, storeId: scope.storeId },
        { session: ctx.session },
      );
    await writeEvidenceState(ctx, {
      id: scope.eventId,
      eventId: scope.eventId,
      storeId: scope.storeId,
      status: "QUEUED",
      reasons: [],
      evidenceIds: old?.evidenceIds ?? [],
      updatedAt: change.changedAt.toISOString(),
    });
  }
}
export function evidenceLeaseId() {
  return randomUUID();
}
