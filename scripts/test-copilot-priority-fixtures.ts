import {
  aggregateCopilotCandidates,
  filterCopilotEligibility,
} from "../packages/analytics-core/src/index";
import type { CopilotCandidate } from "../packages/domain/src/index";
export const priorityStoreId = "00000000-0000-4000-8000-000000000001",
  priorityEvaluatedAt = "2026-10-11T10:00:00Z";
export function priorityFixture(
  id: string,
  changes: Partial<CopilotCandidate> = {},
) {
  const c = {
    ...aggregateCopilotCandidates({
      storeId: priorityStoreId,
      analyticalCandidates: [
        {
          id,
          storeId: priorityStoreId,
          businessDate: "2026-10-11",
          type: "SALES_DROP",
          entityType: "PRODUCT",
          entityId: "product",
          metricId: "sales",
          urgencyScore: 0.3,
          economicImpactScore: 0.5,
          deviationScore: 0.5,
          dataQualityScore: 0.9,
          status: "ACTIVE",
          warnings: [],
          evidence: [],
          sourceLineageIds: [],
          generatedAt: priorityEvaluatedAt,
        },
      ],
      weeklyCommercialCandidates: [],
    }).candidates[0]!,
    ...changes,
  };
  return filterCopilotEligibility({
    storeId: priorityStoreId,
    evaluatedAt: priorityEvaluatedAt,
    candidates: [c],
    entities: [
      {
        id: "product",
        storeId: priorityStoreId,
        kind: "PRODUCT",
        state: "ACTIVE",
        syncState: "SYNCED",
        version: 1,
        humanConfirmed: null,
      },
    ],
    facts: [
      {
        candidateId: c.id,
        storeId: priorityStoreId,
        sourceCurrent: true,
        criticalAmbiguity: false,
        missingCriticalFacts: [],
        purchaseCostKnown: null,
        executionRequired: false,
        executionComplete: null,
      },
    ],
  }).candidates[0]!;
}
