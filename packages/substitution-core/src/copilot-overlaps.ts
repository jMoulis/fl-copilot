import { weeklyCopilotCandidateSchema } from "@fl-copilot/domain";
import { detectPromotionOverlaps } from "./promotion-overlap";
/** A trusted weekly producer reuses the existing overlap rule, without creating advice or execution. */
export function weeklyPromotionOverlapCandidates(
  input: Parameters<typeof detectPromotionOverlaps>[0],
) {
  return detectPromotionOverlaps(input).warnings.map((w) => {
    const directed = w.support.filter(
      (s) => s.kind === "DIRECTED_SUBSTITUTION",
    );
    return weeklyCopilotCandidateSchema.parse({
      id: w.id,
      storeId: input.storeId,
      weekStart: input.plan.weekStart,
      sourceType: "PROMOTION_OVERLAP",
      type: "AVOID_PROMOTION_OVERLAP",
      entityIds: [w.first.productId, w.second.productId],
      urgencyScore: null,
      economicImpactScore: null,
      deviationScore: null,
      dataQualityScore: null,
      relationshipScore:
        directed.length === 1 && directed[0]!.basis === "LEARNED"
          ? directed[0]!.fit
          : null,
      relationshipConfidence:
        directed.length === 1 ? directed[0]!.confidence : null,
      deadlineAt: null,
      evidence: [
        ...[w.first, w.second].map((o) => ({
          id: JSON.stringify([w.id, "OFFER", o.id]),
          sourceType: "COMMERCIAL_OPERATION",
          sourceId: o.id,
          sourceVersion: w.planVersion,
          label: "PLANNED_OFFER",
          value: JSON.stringify({
            operationId: o.operationId,
            saleStart: o.saleStart,
            saleEnd: o.saleEnd,
            customerMechanism: o.customerMechanism,
            sourceReference: o.sourceReference,
          }),
          factKind: "PLANNED",
        })),
        {
          id: JSON.stringify([w.id, "SUPPORT"]),
          sourceType: "SUBSTITUTION",
          sourceId: w.id,
          sourceVersion: w.planVersion,
          label: w.ruleVersion,
          value: JSON.stringify({
            start: w.start,
            end: w.end,
            support: w.support,
            impact: w.impact,
          }),
          factKind: "DERIVED",
        },
      ],
      context: {
        productIds: [w.first.productId, w.second.productId],
        operationIds: [w.first.operationId, w.second.operationId],
        needUnitIds: [...new Set(w.support.map((s) => s.needUnitId))],
        relationshipIds: directed.map((s) => s.relationshipId),
        sourceLineageIds: [
          ...new Set([
            w.first.sourceReference.sourceDocumentId,
            w.second.sourceReference.sourceDocumentId,
          ]),
        ],
        planRevisionId: w.revisionId,
        missingData: [
          "OBSERVED_SALES_TRANSFER",
          "OBSERVED_MARGIN_IMPACT",
          "ACTUAL_EXECUTION",
        ],
        availability: "UNKNOWN",
      },
      warnings: ["QUALITATIVE_OVERLAP_ONLY", "COMPLEMENTARITY_NOT_EVALUATED"],
    });
  });
}
