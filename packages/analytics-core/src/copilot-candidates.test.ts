import { expect, it } from "vitest";
import { aggregateCopilotCandidates } from "./copilot-candidates";
import type { AnalyticalCandidate } from "./candidates";
import type { WeeklyCopilotCandidate } from "@fl-copilot/domain";
const storeId = "00000000-0000-4000-8000-000000000001";
const analytical: AnalyticalCandidate = {
  id: "signal",
  storeId,
  businessDate: "2026-10-11",
  type: "MARGIN_DROP",
  entityType: "PRODUCT",
  entityId: "00001234",
  metricId: "margin",
  urgencyScore: 0.4,
  economicImpactScore: 0,
  deviationScore: 0.8,
  dataQualityScore: 0.6,
  status: "LOW_QUALITY",
  warnings: ["PARTIAL_COMPARISON"],
  evidence: [
    {
      label: "difference",
      value: 0,
      sourceType: "COMPARISON",
      sourceId: "source-1",
    },
    {
      label: "reference",
      value: null,
      sourceType: "KPI",
      sourceId: "source-2",
    },
  ],
  sourceLineageIds: ["import-1"],
  generatedAt: "2026-10-11T10:00:00Z",
};
const weekly: WeeklyCopilotCandidate = {
  id: "signal",
  storeId,
  weekStart: "2026-10-05",
  sourceType: "DEADLINE",
  type: "PLACE_PREORDER_REMINDER",
  entityIds: ["operation-1"],
  urgencyScore: null,
  economicImpactScore: null,
  deviationScore: null,
  dataQualityScore: null,
  relationshipScore: null,
  relationshipConfidence: 0,
  deadlineAt: "2026-10-11T16:00:00Z",
  warnings: [],
  evidence: [
    {
      id: "proof",
      sourceType: "SOURCE_DOCUMENT",
      sourceId: "pdf",
      sourceVersion: 1,
      label: "order deadline",
      value: "2026-10-11",
      factKind: "SOURCE_INSTRUCTION",
    },
  ],
  context: {
    productIds: [],
    operationIds: ["operation-1"],
    needUnitIds: [],
    relationshipIds: [],
    sourceLineageIds: ["pdf"],
    planRevisionId: "revision",
    missingData: ["PURCHASE_COST"],
    availability: "UNKNOWN",
  },
};
it("combines independent origins without collisions or inventing missing scores and keeps exact lineage", () => {
  const frozen = JSON.stringify({ analytical, weekly });
  const r = aggregateCopilotCandidates({
    storeId,
    analyticalCandidates: [analytical],
    weeklyCommercialCandidates: [weekly],
  });
  expect(r.candidates).toHaveLength(2);
  const a = r.candidates.find((c) => c.origin === "ANALYTICAL")!,
    w = r.candidates.find((c) => c.origin === "WEEKLY_COMMERCIAL")!;
  expect(a).toMatchObject({
    type: "INVESTIGATE_MARGIN_DROP",
    economicImpactScore: 0,
    status: "TO_REVIEW",
    entityIds: ["00001234"],
    context: { sourceLineageIds: ["import-1"], availability: "UNKNOWN" },
  });
  expect(a.warnings).toContain("LOW_DATA_QUALITY");
  expect(a.evidence.map((e) => e.value)).toEqual([0, null]);
  expect(w).toMatchObject({
    urgencyScore: null,
    economicImpactScore: null,
    relationshipScore: null,
    relationshipConfidence: 0,
    deadlineAt: weekly.deadlineAt,
    status: "TO_REVIEW",
  });
  expect(w.evidence[0]!.factKind).toBe("SOURCE_INSTRUCTION");
  expect(JSON.stringify({ analytical, weekly })).toBe(frozen);
});
it("deduplicates exact replay, is stable across input ordering, and rejects divergent same-origin IDs", () => {
  const base = {
    storeId,
    analyticalCandidates: [analytical],
    weeklyCommercialCandidates: [weekly],
  };
  expect(
    aggregateCopilotCandidates({
      ...base,
      analyticalCandidates: [analytical, analytical],
      weeklyCommercialCandidates: [weekly, weekly],
    }),
  ).toEqual(aggregateCopilotCandidates(base));
  expect(() =>
    aggregateCopilotCandidates({
      ...base,
      analyticalCandidates: [
        analytical,
        { ...analytical, economicImpactScore: 0.1 },
      ],
    }),
  ).toThrow("DIVERGENT_DUPLICATE");
  const other = { ...weekly, id: "another" };
  expect(
    aggregateCopilotCandidates({
      ...base,
      weeklyCommercialCandidates: [weekly, other],
    }),
  ).toEqual(
    aggregateCopilotCandidates({
      ...base,
      weeklyCommercialCandidates: [other, weekly],
    }),
  );
});
it("rejects foreign store, nonfinite scores and invalid dates instead of laundering inputs", () => {
  expect(() =>
    aggregateCopilotCandidates({
      storeId,
      analyticalCandidates: [
        { ...analytical, storeId: "00000000-0000-4000-8000-000000000002" },
      ],
      weeklyCommercialCandidates: [],
    }),
  ).toThrow("STORE_INVALID");
  expect(() =>
    aggregateCopilotCandidates({
      storeId,
      analyticalCandidates: [],
      weeklyCommercialCandidates: [
        { ...weekly, storeId: "00000000-0000-4000-8000-000000000002" },
      ],
    }),
  ).toThrow("STORE_INVALID");
  for (const a of [
    { ...analytical, dataQualityScore: NaN },
    { ...analytical, businessDate: "2026-02-30" },
  ])
    expect(() =>
      aggregateCopilotCandidates({
        storeId,
        analyticalCandidates: [a],
        weeklyCommercialCandidates: [],
      }),
    ).toThrow();
});
it("retains all conflicting candidates and leaves semantic merging, eligibility and priority to later stages", () => {
  const r = aggregateCopilotCandidates({
    storeId,
    analyticalCandidates: [analytical],
    weeklyCommercialCandidates: [
      {
        ...weekly,
        type: "CONSIDER_LOCAL_PROMOTION",
        entityIds: [analytical.entityId],
      },
    ],
  });
  expect(r.candidates).toHaveLength(2);
  expect(r.candidates.every((c) => c.status === "TO_REVIEW")).toBe(true);
  expect(
    aggregateCopilotCandidates({
      storeId,
      analyticalCandidates: [],
      weeklyCommercialCandidates: [],
    }).candidates,
  ).toEqual([]);
});

it("refuses ambiguous evidence identity and validates scope even when no candidates exist", () => {
  expect(() =>
    aggregateCopilotCandidates({
      storeId: "invalid",
      analyticalCandidates: [],
      weeklyCommercialCandidates: [],
    }),
  ).toThrow();
  expect(() =>
    aggregateCopilotCandidates({
      storeId,
      analyticalCandidates: [],
      weeklyCommercialCandidates: [
        {
          ...weekly,
          evidence: [
            weekly.evidence[0]!,
            { ...weekly.evidence[0]!, value: "changed" },
          ],
        },
      ],
    }),
  ).toThrow("EVIDENCE_DIVERGENT_DUPLICATE");
  const r = aggregateCopilotCandidates({
    storeId,
    analyticalCandidates: [],
    weeklyCommercialCandidates: [
      { ...weekly, evidence: [weekly.evidence[0]!, weekly.evidence[0]!] },
    ],
  });
  expect(r.candidates[0]!.evidence).toHaveLength(1);
});
