import { expect, it } from "vitest";
import { calculateCalendarPeriodComparison } from "./calendar-period-comparison";
it("calculates calendar sums/averages with explicit missing days and independent references", () => {
  const input = {
    kpiId: "sales",
    currentPeriod: { start: "2026-09-01", end: "2026-09-03" },
    referencePeriod: { start: "2026-08-01", end: "2026-08-02" },
    aggregation: "SUM" as const,
    points: [
      {
        businessDate: "2026-09-01",
        value: "100.00",
        status: "AVAILABLE" as const,
      },
      {
        businessDate: "2026-09-02",
        value: "50.00",
        status: "AVAILABLE" as const,
      },
      {
        businessDate: "2026-08-01",
        value: "25.00",
        status: "AVAILABLE" as const,
      },
      {
        businessDate: "2026-08-02",
        value: "25.00",
        status: "AVAILABLE" as const,
      },
    ],
  };
  const sum = calculateCalendarPeriodComparison(input);
  expect(sum.comparison.currentValue).toBe("150.00");
  expect(sum.comparison.referenceValue).toBe("50.00");
  expect(sum.comparison.absoluteDifference).toBe("100.00");
  expect(sum.currentCoverage).toMatchObject({
    expectedDays: 3,
    availableDays: 2,
    missingDays: 1,
    missingDateExamples: ["2026-09-03"],
  });
  expect(sum.comparison.status).toBe("PARTIAL");
  expect(sum.warnings).toContain("DIFFERENT_PERIOD_LENGTHS");
  expect(
    calculateCalendarPeriodComparison({ ...input, aggregation: "AVERAGE" })
      .comparison.currentValue,
  ).toBe("75.00");
});
it("keeps empty leap-year periods unknown and zero-reference percentages unavailable", () => {
  const empty = calculateCalendarPeriodComparison({
    kpiId: "sales",
    currentPeriod: { start: "2024-01-01", end: "2024-12-31" },
    referencePeriod: null,
    aggregation: "SUM",
    points: [],
  });
  expect(empty.currentCoverage.expectedDays).toBe(366);
  expect(empty.currentCoverage.missingDays).toBe(366);
  expect(empty.comparison.currentValue).toBeNull();
  const zero = calculateCalendarPeriodComparison({
    kpiId: "sales",
    currentPeriod: { start: "2026-09-01", end: "2026-09-01" },
    referencePeriod: { start: "2025-07-01", end: "2025-07-01" },
    aggregation: "SUM",
    points: [
      { businessDate: "2026-09-01", value: "10", status: "AVAILABLE" },
      { businessDate: "2025-07-01", value: "0", status: "AVAILABLE" },
    ],
  });
  expect(zero.comparison.absoluteDifference).toBe("10");
  expect(zero.comparison.percentageDifference).toBeNull();
  expect(zero.warnings).toContain("ZERO_REFERENCE");
});
