import { createHash, randomUUID } from "node:crypto";
import {
  productSubstitutionSchema,
  substitutionScoreHistorySchema,
  type ProductSubstitution,
  type SubstitutionScoreHistory,
} from "@fl-copilot/domain";
import {
  calculateConservativeSubstitutionScore,
  conservativeSubstitutionScorePolicy,
} from "@fl-copilot/substitution-core";
import type { MongoCommandMutationContext } from "../sync/processed-command-service";
import { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  serializeProductSubstitution,
  type ProductSubstitutionDocument,
} from "../product-substitution-sync";
import {
  serializeSubstitutionEvidence,
  type SubstitutionEvidenceDocument,
} from "../substitution-evidence-sync";
export type ScoreHistoryDocument = SubstitutionScoreHistory & { _id: string };
export function serializeScoreHistory(row: ScoreHistoryDocument) {
  const { _id, ...data } = row;
  void _id;
  return substitutionScoreHistorySchema.parse(data);
}
const metrics = (r: ProductSubstitution) => ({
  observedSubstitution: r.observedSubstitution,
  relationshipScore: r.relationshipScore,
  confidence: r.confidence,
  evidenceCount: r.evidenceCount,
  lastEvidenceAt: r.lastEvidenceAt,
});

/** Runs inside the same snapshot transaction as evidence and its sync changes. */
export async function publishSubstitutionScores(
  ctx: MongoCommandMutationContext,
  storeId: string,
  sourceProductId: string,
  at: string,
) {
  const { database: db, session } = ctx;
  const eventIds = await db
    .collection<{ _id: string; storeId: string; productId: string }>(
      "storeProductEvents",
    )
    .find({ storeId, productId: sourceProductId }, { session })
    .project<{ _id: string }>({ _id: 1 })
    .limit(1001)
    .toArray();
  if (eventIds.length > 1000) throw Error("SUBSTITUTION_INPUT_LIMIT");
  // No partial refresh is published as a new learned score.
  const pending = await db.collection("substitutionEvidenceWork").findOne(
    {
      storeId,
      _id: { $in: eventIds.map((e) => e._id) },
      $or: [
        {
          $expr: {
            $gt: ["$generation", { $ifNull: ["$processedGeneration", 0] }],
          },
        },
        { lastError: { $type: "string" } },
      ],
    } as never,
    { session },
  );
  if (pending) return;
  const rows = await db
    .collection<ProductSubstitutionDocument>("productSubstitutions")
    .find({ storeId, sourceProductId }, { session })
    .limit(501)
    .toArray();
  if (rows.length > 500) throw Error("SUBSTITUTION_INPUT_LIMIT");
  for (const row of rows) {
    const relation = serializeProductSubstitution(row);
    if (row._id !== relation.id)
      throw Error("SUBSTITUTION_SCORE_IDENTITY_CHANGED");
    if (
      relation.status === "REJECTED" ||
      relation.status === "PROPOSED" ||
      !relation.humanConfirmed
    )
      continue;
    const evidence = (
      await db
        .collection<SubstitutionEvidenceDocument>("substitutionEvidence")
        .find({ storeId, relationshipId: relation.id }, { session })
        .sort({ _id: 1 })
        .limit(1001)
        .toArray()
    ).map(serializeSubstitutionEvidence);
    if (evidence.length > 1000) throw Error("SUBSTITUTION_INPUT_LIMIT");
    const policy = conservativeSubstitutionScorePolicy;
    const calculation = calculateConservativeSubstitutionScore({
      relation,
      evidence,
      policy,
    });
    const compatibility = {
      need: relation.needCompatibility,
      usage: relation.usageCompatibility,
      price: relation.priceCompatibility,
      packaging: relation.packagingCompatibility,
    };
    const inputRevision = createHash("sha256")
      .update(
        JSON.stringify({
          policy,
          compatibility,
          evidence: calculation.decisions,
        }),
      )
      .digest("hex");
    const history = db.collection<ScoreHistoryDocument>(
      "substitutionScoreHistory",
    );
    const previousAudit = await history.findOne(
      { storeId, substitutionId: relation.id },
      { session, sort: { relationshipVersion: -1 } },
    );
    if (previousAudit?.inputRevision === inputRevision) continue;
    if (!calculation.metrics && !previousAudit && relation.evidenceCount === 0)
      continue;
    const nextMetrics = calculation.metrics ?? {
      observedSubstitution: null,
      relationshipScore: null,
      confidence: null,
      evidenceCount: 0,
      lastEvidenceAt: null,
    };
    const next = productSubstitutionSchema.parse({
      ...relation,
      ...nextMetrics,
      status: nextMetrics.evidenceCount ? "LEARNING" : "VALIDATED",
      version: relation.version + 1,
      updatedAt: at,
    });
    const audit = substitutionScoreHistorySchema.parse({
      id: randomUUID(),
      storeId,
      substitutionId: relation.id,
      sourceProductId: relation.sourceProductId,
      substituteProductId: relation.substituteProductId,
      needUnitId: relation.needUnitId,
      version: 1,
      relationshipVersion: next.version,
      inputRevision,
      previous: metrics(relation),
      next: metrics(next),
      reason: !previousAudit
        ? "INITIAL"
        : JSON.stringify(previousAudit.policy) !== JSON.stringify(policy)
          ? "CONFIGURATION_CHANGE"
          : JSON.stringify(previousAudit.compatibility) !==
              JSON.stringify(compatibility)
            ? "USER_VALIDATION"
            : "NEW_EVIDENCE",
      policy,
      compatibility,
      createdAt: at,
      evidence: calculation.decisions.map((d) => {
        const e = evidence.find((e) => e.id === d.evidenceId)!;
        return {
          ...d,
          eventId: e.eventId,
          interpretation: e.interpretation,
          quality: e.dataQuality,
          strength: e.evidenceStrength,
          eventEndedAt: e.eventEndedAt,
          actualSalesValue: e.actualSalesValue,
          expectedSalesValue: e.expectedSalesValue,
          observedVariationPct: e.observedVariationPct,
        };
      }),
    });
    const saved = await db
      .collection<ProductSubstitutionDocument>("productSubstitutions")
      .replaceOne(
        { _id: relation.id, storeId, version: relation.version },
        next,
        { session },
      );
    if (saved.matchedCount !== 1)
      throw Error("SUBSTITUTION_SCORE_REVISION_CHANGED");
    await history.insertOne({ ...audit, _id: audit.id }, { session });
    await db.collection("productSubstitutionHistory").insertOne(
      {
        storeId,
        substitutionId: relation.id,
        version: next.version,
        commandId: null,
        scoreHistoryId: audit.id,
        substitution: next,
      },
      { session },
    );
    const changes = createMongoSyncChangeService();
    await changes.append(ctx, {
      storeId,
      entityType: "product_substitution",
      entityId: relation.id,
      entityVersion: next.version,
      operation: "UPSERT",
      payloadRevision: policy.version,
    });
    await changes.append(ctx, {
      storeId,
      entityType: "substitution_score_history",
      entityId: audit.id,
      entityVersion: 1,
      operation: "UPSERT",
    });
    // Metrics may be unchanged while the proof revision differs: that revision is still auditable.
  }
}
