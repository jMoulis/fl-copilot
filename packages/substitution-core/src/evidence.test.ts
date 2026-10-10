import { it, expect } from "vitest";
import { buildDailySubstitutionEvidence } from "./evidence";
import { evidenceFixture } from "./evidence-fixtures";
it("compares whole Paris days to the previous same weekdays, preserves money lineage and never fabricates quantities", async () => {
  const f = await evidenceFixture(),
    e = await buildDailySubstitutionEvidence(f.input);
  expect(e).toMatchObject({
    status: "READY",
    granularity: "DAY",
    actualSalesValue: "135.00",
    expectedSalesValue: "100.000000",
    observedVariationPct: "35.000000",
    expectedQuantity: null,
    actualQuantity: null,
    interpretation: "SUPPORTS_SUBSTITUTION",
  });
  expect(e.referenceDates).toEqual([
    "2026-09-11",
    "2026-09-18",
    "2026-09-25",
    "2026-10-02",
  ]);
  expect(e.evidenceStrength!).toBeLessThanOrEqual(0.5);
  expect(e.sourceRecordIds).toHaveLength(5);
  expect(e.contextCoverage.weather).toBe("UNKNOWN");
});
it("waits for event closure and completed days, never calling absent data zero", async () => {
  const f = await evidenceFixture();
  expect(
    (
      await buildDailySubstitutionEvidence({
        ...f.input,
        event: { ...f.event, status: "ACTIVE", endedAt: null },
      })
    ).status,
  ).toBe("WAITING_EVENT_END");
  expect(
    (
      await buildDailySubstitutionEvidence({
        ...f.input,
        now: "2026-10-09T23:00:00Z",
      })
    ).status,
  ).toBe("READY");
  expect(
    (
      await buildDailySubstitutionEvidence({
        ...f.input,
        now: "2026-10-09T20:00:00Z",
      })
    ).status,
  ).toBe("WAITING_DAILY_CLOSE");
  const missing = await buildDailySubstitutionEvidence({
    ...f.input,
    sales: f.input.sales.slice(1),
  });
  expect(missing).toMatchObject({
    status: "MISSING_SALES",
    actualSalesValue: null,
    observedVariationPct: null,
    dataQuality: null,
  });
  const zero = await buildDailySubstitutionEvidence({
    ...f.input,
    sales: [f.sale("2026-10-09", "0"), ...f.input.sales.slice(1)],
  });
  expect(zero).toMatchObject({
    status: "READY",
    actualSalesValue: "0.00",
    observedVariationPct: "-100.000000",
    interpretation: "NEUTRAL",
  });
});
it("does not extrapolate hourly response or partial sales cells, and rejects a zero reference", async () => {
  const f = await evidenceFixture(),
    partial = await buildDailySubstitutionEvidence({
      ...f.input,
      event: {
        ...f.event,
        startedAt: "2026-10-09T12:00:00.000Z",
        endedAt: "2026-10-09T16:00:00.000Z",
      },
    });
  expect(partial).toMatchObject({
    observationStart: "2026-10-08T22:00:00.000Z",
    observationEnd: "2026-10-09T22:00:00.000Z",
    actualSalesValue: "135.00",
    partialEventDays: true,
  });
  expect(partial.reasons).toContain("PARTIAL_EVENT_WHOLE_DAY_CONTEXT");
  expect(partial.dataQuality!).toBeLessThan(
    (await buildDailySubstitutionEvidence(f.input)).dataQuality!,
  );
  const missing = await buildDailySubstitutionEvidence({
    ...f.input,
    sales: [f.sale("2026-10-09", null), ...f.input.sales],
  });
  expect(missing.status).toBe("MISSING_SALES");
  const bad = await buildDailySubstitutionEvidence({
    ...f.input,
    sales: [
      f.input.sales[0]!,
      ...f.input.sales.slice(1).map((s) => ({ ...s, salesValue: "0" })),
    ],
  });
  expect(bad).toMatchObject({
    status: "INVALID_REFERENCE",
    expectedSalesValue: "0.000000",
    observedVariationPct: null,
  });
});
it("keeps the full observed total when a later date lacks a reference and records each used daily snapshot", async () => {
  const f = await evidenceFixture();
  const e = await buildDailySubstitutionEvidence({
    ...f.input,
    event: {
      ...f.event,
      endedAt: "2026-10-10T22:00:00.000Z",
      updatedAt: "2026-10-11T12:00:00.000Z",
    },
    now: "2026-10-11T12:00:00Z",
    sales: [...f.input.sales, f.sale("2026-10-10", "50")],
  });
  expect(e).toMatchObject({
    status: "INVALID_REFERENCE",
    actualSalesValue: "185.00",
    expectedSalesValue: null,
  });
  expect(e.dailyComparisons).toHaveLength(2);
});
it("blocks probable duplicate incidents, retains different-type confounders and does not revive rejection", async () => {
  const f = await evidenceFixture(),
    other = { ...f.event, id: f.need.id };
  expect(
    (
      await buildDailySubstitutionEvidence({
        ...f.input,
        events: [f.event, other],
      })
    ).status,
  ).toBe("DUPLICATE_EVENT_REVIEW");
  const different = await buildDailySubstitutionEvidence({
    ...f.input,
    events: [f.event, { ...other, type: "QUALITY_ISSUE" }],
  });
  expect(different.concurrentStoreEventIds).toEqual([f.need.id]);
  expect(different.status).toBe("READY");
  expect(
    (
      await buildDailySubstitutionEvidence({
        ...f.input,
        relation: { ...f.substitution, status: "REJECTED" },
      })
    ).status,
  ).toBe("INELIGIBLE");
});
it("excludes incident/promotion/holiday mismatches from reference and preserves planned vs declared context", async () => {
  const f = await evidenceFixture(),
    operation = {
      id: f.need.id,
      productIds: [f.substitute.id],
      start: "2026-10-02",
      end: "2026-10-02",
      state: "PLANNED" as const,
    };
  const e = await buildDailySubstitutionEvidence({
    ...f.input,
    context: { ...f.input.context, operations: [operation] },
  });
  expect(e.referenceDates).not.toContain("2026-10-02");
  expect(e.concurrentCommercialOperationIds).toEqual([f.need.id]);
  expect(e.contextSnapshot.operations[0]?.state).toBe("PLANNED");
  const holiday = await buildDailySubstitutionEvidence({
    ...f.input,
    context: {
      ...f.input.context,
      publicHolidayCoverage: "KNOWN",
      holidayDates: ["2026-10-09"],
    },
  });
  expect(holiday.status).toBe("INVALID_REFERENCE");
});
it("is stable across repeated runs and learned-score updates, but changes lineage on corrected sales", async () => {
  const f = await evidenceFixture(),
    first = await buildDailySubstitutionEvidence(f.input),
    same = await buildDailySubstitutionEvidence({
      ...f.input,
      now: "2026-10-11T12:00:00Z",
      relation: {
        ...f.substitution,
        status: "LEARNING",
        version: 2,
        evidenceCount: 1,
        relationshipScore: 0.3,
        confidence: 0.1,
      },
    });
  expect(same.id).toBe(first.id);
  expect(same.inputRevision).toBe(first.inputRevision);
  const correction = await buildDailySubstitutionEvidence({
    ...f.input,
    sales: f.input.sales.map((s, i) =>
      i ? s : { ...s, version: 2, salesValue: "120" },
    ),
  });
  expect(correction.id).toBe(first.id);
  expect(correction.inputRevision).not.toBe(first.inputRevision);
  expect(correction.observedVariationPct).toBe("20.000000");
});
