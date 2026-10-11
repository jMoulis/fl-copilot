import { it, expect } from "vitest";
import {
  scoreCopilotPriorities,
  conservativeCopilotPriorityPolicy,
} from "./copilot-priority";
import {
  priorityFixture,
  priorityStoreId as storeId,
  priorityEvaluatedAt as evaluatedAt,
} from "../../../scripts/test-copilot-priority-fixtures";
it("allows an urgent deadline to outrank a larger but less urgent opportunity with all components explained", () => {
  const soon = priorityFixture("soon", {
    urgencyScore: 0.5,
    economicImpactScore: 0.3,
    deadlineAt: "2026-10-11T12:00:00Z",
  });
  const later = priorityFixture("later", {
    urgencyScore: 0.2,
    economicImpactScore: 0.7,
    deadlineAt: "2026-10-15T12:00:00Z",
  });
  const r = scoreCopilotPriorities({
    storeId,
    evaluatedAt,
    candidates: [later, soon],
  });
  expect(r.candidates[0]!.id).toBe(soon.id);
  expect(r.candidates[0]!.priority.deadline).toEqual({
    remainingHours: 2,
    band: "WITHIN_24_HOURS",
    boost: 0.3,
  });
  expect(r.candidates[0]!.priority.components.economicImpact).toEqual({
    value: 0.3,
    weight: 0.45,
    contribution: 0.135,
  });
});
it("does not put low-value extreme percentage deviation above a material economic signal", () => {
  const tiny = priorityFixture("tiny", {
      urgencyScore: 0.3,
      economicImpactScore: 0.01,
      deviationScore: 1,
    }),
    large = priorityFixture("large", {
      urgencyScore: 0.3,
      economicImpactScore: 0.8,
      deviationScore: 0.2,
    });
  expect(
    scoreCopilotPriorities({ storeId, evaluatedAt, candidates: [tiny, large] })
      .candidates[0]!.id,
  ).toBe(large.id);
});
it("keeps unknown versus zero and does not renormalize missing dimensions or fabricate financial meaning", () => {
  const c = priorityFixture("unknown", {
      economicImpactScore: null,
      deviationScore: 0,
    }),
    r = scoreCopilotPriorities({ storeId, evaluatedAt, candidates: [c] })
      .candidates[0]!;
  expect(r.economicImpactScore).toBeNull();
  expect(r.priority.components.economicImpact.contribution).toBeNull();
  expect(r.priority.components.deviation.contribution).toBe(0);
  expect(r.priority.baseScore).toBe(0.27);
  expect(r.priority.missingDimensions).toEqual(["economicImpact"]);
});
it("keeps review/suppressed records unranked and cannot use expired or stale eligibility", () => {
  const review = priorityFixture("review", { dataQualityScore: null }),
    expired = priorityFixture("past", { deadlineAt: "2026-10-10T10:00:00Z" });
  const r = scoreCopilotPriorities({
    storeId,
    evaluatedAt,
    candidates: [expired, review],
  });
  expect(r.candidates.every((c) => c.priority.score === null)).toBe(true);
  expect(() =>
    scoreCopilotPriorities({
      storeId,
      evaluatedAt: "2026-10-11T11:00:00Z",
      candidates: [priorityFixture("fresh")],
    }),
  ).toThrow("STALE_ELIGIBILITY");
  expect(() =>
    scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [{ ...expired, status: "ELIGIBLE" }],
    }),
  ).toThrow("EXPIRED_ELIGIBILITY");
});
it("uses inclusive deadline boundaries and stable ties without truncating to three", () => {
  for (const [hours, band] of [
    [0, "WITHIN_24_HOURS"],
    [24, "WITHIN_24_HOURS"],
    [48, "WITHIN_48_HOURS"],
    [168, "WITHIN_7_DAYS"],
    [169, "LATER"],
  ] as const) {
    const deadlineAt = new Date(
      Date.parse(evaluatedAt) + hours * 3600000,
    ).toISOString();
    expect(
      scoreCopilotPriorities({
        storeId,
        evaluatedAt,
        candidates: [priorityFixture("boundary", { deadlineAt })],
      }).candidates[0]!.priority.deadline.band,
    ).toBe(band);
  }
  const cs = ["d", "b", "a", "c"].map((id) => priorityFixture(id));
  const input = { storeId, evaluatedAt, candidates: cs },
    before = JSON.stringify(input);
  expect(scoreCopilotPriorities(input)).toEqual(
    scoreCopilotPriorities({ ...input, candidates: [...cs].reverse() }),
  );
  expect(scoreCopilotPriorities(input).candidates).toHaveLength(4);
  expect(JSON.stringify(input)).toBe(before);
});
it("caps at one, validates policy/tenant/duplicates and keeps the exact policy in the result", () => {
  const c = priorityFixture("cap", {
    urgencyScore: 1,
    economicImpactScore: 1,
    deviationScore: 1,
    dataQualityScore: 1,
    deadlineAt: evaluatedAt,
  });
  expect(
    scoreCopilotPriorities({ storeId, evaluatedAt, candidates: [c] })
      .candidates[0]!.priority.score,
  ).toBe(1);
  expect(() =>
    scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [{ ...c, storeId: "00000000-0000-4000-8000-000000000002" }],
    }),
  ).toThrow("STORE_INVALID");
  expect(() =>
    scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [c],
      policy: {
        ...conservativeCopilotPriorityPolicy,
        weights: {
          urgency: 1,
          economicImpact: 1,
          deviation: 1,
          dataQuality: 1,
        },
      },
    }),
  ).toThrow();
  const r = scoreCopilotPriorities({
    storeId,
    evaluatedAt,
    candidates: [c, c],
  });
  expect(r.candidates).toHaveLength(1);
  expect(r.policy).toEqual(conservativeCopilotPriorityPolicy);
});
