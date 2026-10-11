import { it, expect } from "vitest";
import { aggregateCopilotCandidates } from "./copilot-candidates";
import { filterCopilotEligibility } from "./copilot-eligibility";
import type {
  WeeklyCopilotCandidate,
  CopilotCandidateFacts,
  CopilotEntitySnapshot,
} from "@fl-copilot/domain";
const storeId = "00000000-0000-4000-8000-000000000001",
  evaluatedAt = "2026-10-11T10:00:00Z";
function fixture() {
  const weekly: WeeklyCopilotCandidate = {
    id: "local-promo",
    storeId,
    weekStart: "2026-10-05",
    sourceType: "WASTE_OPPORTUNITY",
    type: "CONSIDER_LOCAL_PROMOTION",
    entityIds: ["00001234"],
    urgencyScore: 0.4,
    economicImpactScore: null,
    deviationScore: 0,
    dataQualityScore: 0.8,
    relationshipScore: null,
    relationshipConfidence: null,
    deadlineAt: null,
    warnings: [],
    evidence: [],
    context: {
      productIds: ["00001234"],
      operationIds: [],
      needUnitIds: [],
      relationshipIds: [],
      sourceLineageIds: ["import"],
      planRevisionId: null,
      missingData: [],
      availability: "UNKNOWN",
    },
  };
  const candidate = aggregateCopilotCandidates({
    storeId,
    analyticalCandidates: [],
    weeklyCommercialCandidates: [weekly],
  }).candidates[0]!;
  const facts: CopilotCandidateFacts = {
    candidateId: candidate.id,
    storeId,
    sourceCurrent: true,
    criticalAmbiguity: false,
    missingCriticalFacts: [],
    purchaseCostKnown: true,
    executionRequired: false,
    executionComplete: null,
  };
  const entity: CopilotEntitySnapshot = {
    id: "00001234",
    storeId,
    kind: "PRODUCT",
    state: "ACTIVE",
    syncState: "PENDING",
    version: 1,
    humanConfirmed: null,
  };
  return {
    input: {
      storeId,
      evaluatedAt,
      candidates: [candidate],
      entities: [entity],
      facts: [facts],
    },
    candidate,
    facts,
    entity,
  };
}
const codes = (r: ReturnType<typeof filterCopilotEligibility>) =>
  r.candidates[0]!.eligibility.reasons.map((r) => r.code);
it("admits a trusted pending offline product without inventing stock or economic impact and keeps inputs immutable", () => {
  const f = fixture(),
    before = JSON.stringify(f.input),
    r = filterCopilotEligibility(f.input);
  expect(r.candidates[0]).toMatchObject({
    status: "ELIGIBLE",
    economicImpactScore: null,
    context: { availability: "UNKNOWN" },
    eligibility: {
      ruleVersion: "copilot-eligibility.v1",
      evaluatedAt,
      reasons: [],
    },
  });
  expect(JSON.stringify(f.input)).toBe(before);
});
it("suppresses confirmed invalid entities, rejected relations, non-applicable operations and stale sources with explicit reasons", () => {
  const f = fixture();
  for (const state of ["INACTIVE", "MISSING"] as const) {
    const r = filterCopilotEligibility({
      ...f.input,
      entities: [{ ...f.entity, state }],
    });
    expect(r.candidates[0]!.status).toBe("SUPPRESSED");
    expect(codes(r)).toContain("INVALID_ENTITY");
  }
  const relation = {
    ...f.entity,
    id: "relation",
    kind: "RELATION" as const,
    state: "REJECTED" as const,
    humanConfirmed: true,
  };
  const operation = {
    ...f.entity,
    id: "operation",
    kind: "OPERATION" as const,
    state: "NOT_APPLICABLE" as const,
  };
  const c = {
    ...f.candidate,
    context: {
      ...f.candidate.context,
      relationshipIds: [relation.id],
      operationIds: [operation.id],
    },
  };
  const r = filterCopilotEligibility({
    ...f.input,
    candidates: [c],
    entities: [f.entity, relation, operation],
    facts: [{ ...f.facts, sourceCurrent: false }],
  });
  expect(r.candidates[0]!.status).toBe("SUPPRESSED");
  expect(codes(r)).toEqual(
    expect.arrayContaining([
      "RELATION_REJECTED",
      "OPERATION_NOT_APPLICABLE",
      "STALE_SOURCE",
    ]),
  );
});
it("downgrades unknown/conflicted state rather than treating a missing snapshot as a nonexistent entity", () => {
  const f = fixture();
  expect(
    codes(filterCopilotEligibility({ ...f.input, entities: [] })),
  ).toContain("ENTITY_UNVERIFIED");
  const r = filterCopilotEligibility({
    ...f.input,
    entities: [{ ...f.entity, syncState: "CONFLICT" }],
    facts: [],
  });
  expect(r.candidates[0]!.status).toBe("TO_REVIEW");
  expect(codes(r)).toEqual(
    expect.arrayContaining([
      "ENTITY_UNRESOLVED",
      "FACTS_UNVERIFIED",
      "MISSING_REQUIRED_COST",
    ]),
  );
});
it("requires a known cost for price-changing proposals but allows price inspection and genuine zero quality stays zero", () => {
  const f = fixture(),
    unknown = filterCopilotEligibility({
      ...f.input,
      facts: [{ ...f.facts, purchaseCostKnown: null }],
    });
  expect(codes(unknown)).toContain("MISSING_REQUIRED_COST");
  const inspect = filterCopilotEligibility({
    ...f.input,
    candidates: [{ ...f.candidate, type: "CHECK_PRICE" }],
    facts: [{ ...f.facts, purchaseCostKnown: false }],
  });
  expect(inspect.candidates[0]!.status).toBe("ELIGIBLE");
  expect(
    codes(
      filterCopilotEligibility({
        ...f.input,
        candidates: [{ ...f.candidate, dataQualityScore: 0 }],
      }),
    ),
  ).toContain("INSUFFICIENT_QUALITY");
  expect(
    codes(
      filterCopilotEligibility({
        ...f.input,
        candidates: [{ ...f.candidate, dataQualityScore: null }],
      }),
    ),
  ).toContain("UNKNOWN_QUALITY");
});
it("permits useful data-validation advice despite weak quality while retaining ambiguity and execution prerequisites", () => {
  const f = fixture(),
    c = { ...f.candidate, type: "VALIDATE_DATA" as const, dataQualityScore: 0 };
  expect(
    filterCopilotEligibility({ ...f.input, candidates: [c] }).candidates[0]!
      .status,
  ).toBe("ELIGIBLE");
  const r = filterCopilotEligibility({
    ...f.input,
    candidates: [c],
    facts: [
      {
        ...f.facts,
        criticalAmbiguity: true,
        missingCriticalFacts: ["BUSINESS_DATE"],
        executionRequired: true,
        executionComplete: null,
      },
    ],
  });
  expect(r.candidates[0]!.status).toBe("TO_REVIEW");
  expect(codes(r)).toEqual(
    expect.arrayContaining([
      "CRITICAL_AMBIGUITY",
      "MISSING_CRITICAL_FACT",
      "INCOMPLETE_EXECUTION",
    ]),
  );
  expect(codes(r)).not.toContain("INSUFFICIENT_QUALITY");
});
it("compares exact deadline instants, retaining equality and never inventing an hour for an absent deadline", () => {
  const f = fixture();
  expect(
    filterCopilotEligibility({
      ...f.input,
      candidates: [{ ...f.candidate, deadlineAt: evaluatedAt }],
    }).candidates[0]!.status,
  ).toBe("ELIGIBLE");
  const r = filterCopilotEligibility({
    ...f.input,
    candidates: [{ ...f.candidate, deadlineAt: "2026-10-11T09:59:59Z" }],
  });
  expect(r.candidates[0]!.status).toBe("SUPPRESSED");
  expect(codes(r)).toContain("OBSOLETE_DEADLINE");
});
it("fails tenant/kind/duplicate corruption and gives stable replay without dropping suppressed candidates", () => {
  const f = fixture(),
    foreign = "00000000-0000-4000-8000-000000000002";
  expect(() =>
    filterCopilotEligibility({
      ...f.input,
      entities: [{ ...f.entity, storeId: foreign }],
    }),
  ).toThrow("STORE_INVALID");
  expect(() =>
    filterCopilotEligibility({
      ...f.input,
      facts: [f.facts, { ...f.facts, purchaseCostKnown: false }],
    }),
  ).toThrow("DIVERGENT_SNAPSHOT");
  expect(
    codes(
      filterCopilotEligibility({
        ...f.input,
        entities: [{ ...f.entity, kind: "OTHER" }],
      }),
    ),
  ).toContain("INVALID_ENTITY");
  expect(
    filterCopilotEligibility({
      ...f.input,
      candidates: [f.candidate, f.candidate],
      entities: [f.entity, f.entity],
    }),
  ).toEqual(filterCopilotEligibility(f.input));
});
it("uses configured quality boundary without re-ranking candidates or changing source scores", () => {
  const f = fixture(),
    low = { ...f.candidate, dataQualityScore: 0.7 };
  expect(
    filterCopilotEligibility({ ...f.input, candidates: [low] }).candidates[0]!
      .status,
  ).toBe("ELIGIBLE");
  const r = filterCopilotEligibility({
    ...f.input,
    candidates: [low],
    policy: { version: "copilot-eligibility.v1", minimumDataQuality: 0.8 },
  });
  expect(r.candidates[0]!.dataQualityScore).toBe(0.7);
  expect(r.candidates[0]!.status).toBe("TO_REVIEW");
});
