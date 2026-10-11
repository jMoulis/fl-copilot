import { it, expect } from "vitest";
import type { CopilotActionIntent } from "@fl-copilot/domain";
import { scoreCopilotPriorities } from "./copilot-priority";
import { detectCopilotConflicts } from "./copilot-conflicts";
import {
  priorityFixture,
  priorityStoreId as storeId,
  priorityEvaluatedAt as evaluatedAt,
} from "../../../scripts/test-copilot-priority-fixtures";
function fixture() {
  const a = priorityFixture("increase"),
    b = priorityFixture("reduce"),
    batch = scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [a, b],
    });
  const intent: CopilotActionIntent = {
    id: "intent-a",
    storeId,
    candidateId: a.id,
    productId: "product",
    axis: "DISPLAY",
    direction: "INCREASE",
    startsAt: "2026-10-11T10:00:00Z",
    endsAt: "2026-10-12T10:00:00Z",
  };
  return {
    batch,
    a,
    b,
    first: intent,
    second: {
      ...intent,
      id: "intent-b",
      candidateId: b.id,
      direction: "REDUCE" as const,
    },
  };
}
it("flags explicit incompatible exposure on the same product and retains both complete candidates without choosing or merging", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    r = detectCopilotConflicts({
      batch: f.batch,
      intents: [f.first, f.second],
    });
  expect(r.tradeOffs).toHaveLength(1);
  expect(r.independentCandidateIds).toEqual([]);
  expect(r.batch).toEqual(f.batch);
  expect(r.tradeOffs[0]).toMatchObject({
    certainty: "OVERLAPPING_PERIODS",
    resolution: "HUMAN_TRADE_OFF_REQUIRED",
    overlapStartsAt: "2026-10-11T10:00:00.000Z",
  });
  expect(r.tradeOffs[0]!.sourceCandidateIds.sort()).toEqual([
    "increase",
    "reduce",
  ]);
  expect(JSON.stringify(f)).toBe(before);
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [{ ...f.first, direction: "MAINTAIN" }, f.second],
    }).tradeOffs,
  ).toHaveLength(1);
});
it("flags promotion activation versus avoidance but does not equate distinct axes or compatible display intentions", () => {
  const f = fixture();
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [
        { ...f.first, axis: "PROMOTION", direction: "ACTIVATE" },
        { ...f.second, axis: "PROMOTION", direction: "AVOID" },
      ],
    }).tradeOffs,
  ).toHaveLength(1);
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [
        f.first,
        { ...f.second, axis: "PROMOTION", direction: "AVOID" },
      ],
    }).tradeOffs,
  ).toEqual([]);
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [f.first, { ...f.second, direction: "MAINTAIN" }],
    }).tradeOffs,
  ).toEqual([]);
});
it("checks exact intersecting periods including a boundary instant and marks undated intent as possible", () => {
  const f = fixture();
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [
        f.first,
        {
          ...f.second,
          startsAt: "2026-10-12T10:00:01Z",
          endsAt: "2026-10-13T10:00:00Z",
        },
      ],
    }).tradeOffs,
  ).toEqual([]);
  expect(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [
        f.first,
        {
          ...f.second,
          startsAt: f.first.endsAt,
          endsAt: "2026-10-13T10:00:00Z",
        },
      ],
    }).tradeOffs[0]!.certainty,
  ).toBe("OVERLAPPING_PERIODS");
  const r = detectCopilotConflicts({
    batch: f.batch,
    intents: [f.first, { ...f.second, startsAt: null, endsAt: null }],
  });
  expect(r.tradeOffs[0]).toMatchObject({
    certainty: "POSSIBLE_UNKNOWN_PERIOD",
    overlapStartsAt: null,
    overlapEndsAt: null,
  });
});
it("never manufactures an intent from a broad candidate label or emits suppressed/review alternatives", () => {
  const f = fixture();
  const r = detectCopilotConflicts({ batch: f.batch, intents: [] });
  expect(r.tradeOffs).toEqual([]);
  expect(r.candidatesWithoutIntent).toHaveLength(2);
  for (const status of ["SUPPRESSED", "TO_REVIEW"] as const) {
    const batch = scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [f.a, { ...f.b, status }],
    });
    expect(
      detectCopilotConflicts({ batch, intents: [f.first, f.second] }).tradeOffs,
    ).toEqual([]);
  }
});
it("has stable replay, deduplicates a pair's supporting intents, and preserves separate products", () => {
  const f = fixture(),
    extra = { ...f.first, id: "intent-extra", direction: "MAINTAIN" as const };
  const r = detectCopilotConflicts({
    batch: f.batch,
    intents: [f.first, f.second, extra, f.first],
  });
  expect(r.tradeOffs).toHaveLength(1);
  expect(r.tradeOffs[0]!.options).toHaveLength(3);
  expect(r).toEqual(
    detectCopilotConflicts({
      batch: f.batch,
      intents: [extra, f.second, f.first],
    }),
  );
  const different = {
    ...f.b,
    context: { ...f.b.context, productIds: ["other"] },
    entityIds: ["other"],
  };
  const batch = scoreCopilotPriorities({
    storeId,
    evaluatedAt,
    candidates: [f.a, different],
  });
  expect(
    detectCopilotConflicts({
      batch,
      intents: [f.first, { ...f.second, productId: "other" }],
    }).tradeOffs,
  ).toEqual([]);
});
it("rejects tenant/target/identity/period corruption without accepting model-authored scope", () => {
  const f = fixture();
  for (const intent of [
    { ...f.first, storeId: "00000000-0000-4000-8000-000000000002" },
    { ...f.first, productId: "foreign" },
    { ...f.first, candidateId: "missing" },
    { ...f.first, startsAt: "2026-10-13T10:00:00Z" },
  ])
    expect(() =>
      detectCopilotConflicts({ batch: f.batch, intents: [intent] }),
    ).toThrow();
  expect(() =>
    detectCopilotConflicts({
      batch: f.batch,
      intents: [f.first, { ...f.first, direction: "REDUCE" }],
    }),
  ).toThrow("DIVERGENT_INTENT");
});

it("keeps expired actions out of current trade-offs, rejects internal opposition and does not invent a single date span for several conflicts", () => {
  const f = fixture();
  const past = {
    ...f.first,
    startsAt: "2026-10-09T10:00:00Z",
    endsAt: "2026-10-10T10:00:00Z",
  };
  const r = detectCopilotConflicts({
    batch: f.batch,
    intents: [past, f.second],
  });
  expect(r.tradeOffs).toEqual([]);
  expect(r.ignoredIntents).toEqual([
    { id: past.id, reason: "PAST_ACTION_WINDOW" },
  ]);
  expect(() =>
    detectCopilotConflicts({
      batch: f.batch,
      intents: [f.first, { ...f.second, candidateId: f.first.candidateId }],
    }),
  ).toThrow("INTERNAL_INTENT");
  const extra = {
    ...f.first,
    id: "later-interval",
    startsAt: "2026-10-11T11:00:00Z",
  };
  const multiple = detectCopilotConflicts({
    batch: f.batch,
    intents: [f.first, f.second, extra],
  });
  expect(multiple.tradeOffs[0]).toMatchObject({
    certainty: "MULTIPLE_OVERLAPPING_PERIODS",
    overlapStartsAt: null,
    overlapEndsAt: null,
  });
});
