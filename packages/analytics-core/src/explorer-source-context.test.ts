import { it, expect } from "vitest";
import {
  compareExplorerPeriod,
  explorerChartBuckets,
  explorerReference,
  shiftExplorerPeriod,
} from "./explorer-period";
import type { AnalyticsExplorerPeriod } from "@fl-copilot/domain";
const period: Extract<AnalyticsExplorerPeriod, { kind: "range" }> = {
  kind: "range",
  current: { start: "2026-10-01", end: "2026-10-03" },
  reference: { start: "2025-09-02", end: "2025-09-04" },
  aggregation: "AVERAGE",
  basis: "DEPARTMENT",
};
const p = (
  businessDate: string,
  value: string | null,
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" = "AVAILABLE",
) => ({ businessDate, value, status });
it("preserves an explicit period, its chosen reference and daily mean instead of silently substituting a month or ISO baseline", () => {
  const points = [
    p("2026-10-01", "10"),
    p("2026-10-02", "20"),
    p("2026-10-03", "30"),
    p("2025-09-02", "5"),
    p("2025-09-03", "10"),
    p("2025-09-04", "15"),
  ];
  const r = compareExplorerPeriod({
    period,
    today: "2026-10-19",
    kpiId: "sales",
    points,
  });
  expect(r.range).toEqual(period.current);
  expect(r.referenceRange).toEqual(period.reference);
  expect(r.mode).toBe("EXPLICIT");
  expect(r.total).toBe("20");
  expect(r.comparison?.referenceValue).toBe("10");
  expect(r.comparison?.percentageDifference).toBe("100.00");
  expect(explorerReference(period)).toMatchObject({
    current: period.reference,
    reference: null,
  });
  expect(() => shiftExplorerPeriod(period, 1)).toThrow("FIXED_SOURCE");
});
it("keeps partial means, missing/zero/negative values and refuses precise open, unequal SUM or incomplete deltas", () => {
  const points = [
    p("2026-10-01", "0"),
    p("2026-10-02", "-10", "PARTIAL"),
    p("2025-09-02", "0"),
    p("2025-09-03", "0"),
    p("2025-09-04", "0"),
  ];
  const partial = compareExplorerPeriod({
    period,
    today: "2026-10-19",
    kpiId: "margin",
    points,
  });
  expect(partial.total).toBe("-5");
  expect(partial.comparison).toBeNull();
  expect(partial.coverage).toMatchObject({
    complete: 1,
    partial: 1,
    missing: 1,
  });
  expect(
    compareExplorerPeriod({
      period: { ...period, reference: null },
      today: "2026-10-19",
      kpiId: "sales",
      points: points.filter((p) => p.businessDate.startsWith("2026")),
    }).warnings,
  ).not.toContain("OPEN_OR_FUTURE_PERIOD");
  const short = {
    ...period,
    aggregation: "SUM" as const,
    current: { start: "2026-10-01", end: "2026-10-01" },
  };
  expect(
    compareExplorerPeriod({
      period: short,
      today: "2026-10-19",
      kpiId: "sales",
      points: [points[0], ...points.slice(2)],
    }).comparisonStatus,
  ).toBe("not_comparable");
  expect(
    compareExplorerPeriod({
      period,
      today: "2026-10-02",
      kpiId: "margin",
      points,
    }).comparison,
  ).toBeNull();
});
it("buckets broad source ranges by clipped calendar months, without hourly invention or outside-period amounts", () => {
  const range = {
    ...period,
    current: { start: "2026-01-15", end: "2026-04-04" },
    reference: null,
  };
  const bins = explorerChartBuckets(range, [
    p("2026-01-15", "10"),
    p("2026-01-16", "20"),
    p("2026-04-04", "0"),
  ]);
  expect(bins).toHaveLength(4);
  expect(bins[0]).toMatchObject({
    date: "2026-01-15",
    end: "2026-01-31",
    value: "15",
    complete: false,
    monthly: true,
  });
  expect(bins.at(-1)).toMatchObject({
    date: "2026-04-01",
    end: "2026-04-04",
    value: "0",
    expected: 4,
  });
});
