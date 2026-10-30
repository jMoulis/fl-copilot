import { describe, it, expect } from "vitest";
import {
  isoWeekOf,
  explorerPeriodFromDate,
  explorerRange,
  explorerReference,
  explorerReferenceRange,
  shiftExplorerPeriod,
  explorerDays,
  compareExplorerPeriod,
  explorerChartBuckets,
} from "./explorer-period";
import type { DatedKpiValue } from "./comparison";
const points = (
  start: string,
  values: (string | null)[],
  status: DatedKpiValue["status"] = "AVAILABLE",
) =>
  values.map((value, i) => ({
    businessDate: explorerDays({
      start,
      end: new Date(Date.parse(start) + i * 86400000)
        .toISOString()
        .slice(0, 10),
    }).at(-1)!,
    value,
    status: value === null ? ("UNAVAILABLE" as const) : status,
  }));
describe("Explorer calendar and comparable coverage", () => {
  it("uses ISO years and weekdays, including cross-year weeks and the actual 2026 mockup dates", () => {
    expect(isoWeekOf("2021-01-01")).toEqual({
      year: 2020,
      week: 53,
      weekday: 4,
    });
    expect(explorerRange({ kind: "week", year: 2026, week: 43 })).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
    });
    expect(explorerRange({ kind: "week", year: 2020, week: 53 })).toEqual({
      start: "2020-12-28",
      end: "2021-01-03",
    });
    expect(explorerReference({ kind: "day", date: "2026-10-15" })).toEqual({
      kind: "day",
      date: "2025-10-16",
    });
    expect(explorerReference({ kind: "week", year: 2026, week: 42 })).toEqual({
      kind: "week",
      year: 2025,
      week: 42,
    });
    expect(
      explorerReference({ kind: "week", year: 2020, week: 53 }),
    ).toBeNull();
    expect(() =>
      explorerRange({ kind: "week", year: 2021, week: 53 }),
    ).toThrow();
  });
  it("shifts exact periods and anchors granularity without losing calendar boundaries", () => {
    expect(
      shiftExplorerPeriod({ kind: "week", year: 2020, week: 53 }, 1),
    ).toEqual({ kind: "week", year: 2021, week: 1 });
    expect(
      shiftExplorerPeriod({ kind: "month", year: 2026, month: 12 }, 1),
    ).toEqual({ kind: "month", year: 2027, month: 1 });
    expect(explorerRange({ kind: "month", year: 2024, month: 2 }).end).toBe(
      "2024-02-29",
    );
    expect(explorerPeriodFromDate("week", "2026-10-31")).toEqual({
      kind: "week",
      year: 2026,
      week: 44,
    });
    expect(() => explorerPeriodFromDate("day", "2026-02-30")).toThrow();
  });
  it("compares only completed equivalent weekdays and keeps the full-period observed total distinct", () => {
    const r = compareExplorerPeriod({
      period: { kind: "week", year: 2026, week: 42 },
      today: "2026-10-15",
      kpiId: "sales",
      points: [
        ...points("2026-10-12", ["10", "20", "30", "7"]),
        ...points("2025-10-13", ["5", "10", "15", "900", "900", "900", "900"]),
      ],
    });
    expect(r.total).toBe("67.00");
    expect(r.comparedDays).toBe(3);
    expect(r.comparison?.currentValue).toBe("60");
    expect(r.comparison?.referenceValue).toBe("30");
    expect(r.comparison?.percentageDifference).toBe("100.00");
    expect(r.coverage).toEqual({
      complete: 4,
      partial: 0,
      missing: 3,
      expected: 7,
    });
  });
  it("compares the intersection of equivalent days and labels an incomplete period", () => {
    const r = compareExplorerPeriod({
      period: { kind: "week", year: 2026, week: 42 },
      today: "2026-10-19",
      kpiId: "sales",
      points: [
        ...points("2026-10-12", ["10", null, "30", "40", "50", "60", "70"]),
        ...points("2025-10-13", ["1", "2", null, "4", "5", "6", "7"]),
      ],
    });
    expect(r.comparison).toMatchObject({
      currentValue: "230",
      referenceValue: "23",
      status: "PARTIAL",
    });
    expect(r.comparedDays).toBe(5);
    expect(r.comparisonStatus).toBe("partial");
    expect(r.total).toBe("260.00");
  });
  it("keeps a usable partial monetary comparison explicitly indicative", () => {
    const r = compareExplorerPeriod({
      period: { kind: "day", date: "2026-10-15" },
      today: "2026-10-19",
      kpiId: "sales",
      points: [
        ...points("2026-10-15", ["12.31"], "PARTIAL"),
        ...points("2025-10-16", ["4"]),
      ],
    });
    expect(r.total).toBe("12.31");
    expect(r.coverage.partial).toBe(1);
    expect(r.comparison).toMatchObject({
      currentValue: "12.31",
      referenceValue: "4",
      status: "PARTIAL",
    });
  });
  it("preserves zero/negative amounts and never produces an infinite percent", () => {
    const r = compareExplorerPeriod({
      period: { kind: "day", date: "2026-10-15" },
      today: "2026-10-19",
      kpiId: "margin",
      points: [
        ...points("2026-10-15", ["-12.31"]),
        ...points("2025-10-16", ["0"]),
      ],
    });
    expect(r.comparison?.absoluteDifference).toBe("-12.31");
    expect(r.comparison?.percentageDifference).toBeNull();
  });
  it("uses an ISO-aligned leap-month range and does not invent a week 53 counterpart", () => {
    const r = compareExplorerPeriod({
      period: { kind: "month", year: 2024, month: 2 },
      today: "2026-10-19",
      kpiId: "sales",
      points: [],
    });
    expect(r.comparisonStatus).toBe("missing_baseline");
    expect(r.referenceRange).toEqual({
      start: "2023-02-02",
      end: "2023-03-02",
    });
    const w = compareExplorerPeriod({
      period: { kind: "week", year: 2020, week: 53 },
      today: "2026-10-19",
      kpiId: "sales",
      points: [],
    });
    expect(w.reference).toBeNull();
    expect(w.total).toBeNull();
    expect(w.coverage.missing).toBe(7);
  });
  it("rejects duplicate and foreign-period points rather than truncating", () => {
    const p = {
        businessDate: "2026-10-15",
        value: "1",
        status: "AVAILABLE" as const,
      },
      base = {
        period: { kind: "day" as const, date: "2026-10-15" },
        today: "2026-10-19",
        kpiId: "sales",
      };
    expect(() => compareExplorerPeriod({ ...base, points: [p, p] })).toThrow();
    expect(() =>
      compareExplorerPeriod({
        ...base,
        points: [{ ...p, businessDate: "2026-01-01" }],
      }),
    ).toThrow();
  });
});
it("aligns month and elapsed-year days by ISO week/weekday, including leap years", () => {
  const period = { kind: "year" as const, year: 2025 };
  const range = explorerReferenceRange(period)!;
  const current = points(
    "2025-01-01",
    Array.from({ length: 60 }, () => "1"),
  );
  const ref = points(
    range.start,
    Array.from({ length: 60 }, () => "2"),
  );
  const r = compareExplorerPeriod({
    period,
    today: "2025-03-02",
    kpiId: "sales",
    points: [...current, ...ref],
  });
  expect(r.comparedDays).toBe(60);
  expect(r.comparison?.referenceValue).toBe("120");
  expect(r.comparisonDates.at(-1)).toEqual({
    current: "2025-03-01",
    reference: "2024-03-02",
  });
  expect(
    explorerReferenceRange({ kind: "month", year: 2026, month: 10 }),
  ).toEqual({ start: "2025-10-02", end: "2025-11-01" });
});

it("keeps zero and negative chart amounts distinct from missing daily and monthly bins", () => {
  const week = { kind: "week" as const, year: 2026, week: 42 };
  const r = compareExplorerPeriod({
    period: week,
    today: "2026-10-19",
    kpiId: "margin",
    points: points("2026-10-12", ["0", "-12.31", null, "4"], "PARTIAL"),
  });
  const bins = explorerChartBuckets(week, r.points);
  expect(bins.map((b) => b.value)).toEqual([
    "0.00",
    "-12.31",
    null,
    "4.00",
    null,
    null,
    null,
  ]);
  expect(bins.every((b) => !b.complete)).toBe(true);
  const months = explorerChartBuckets({ kind: "year", year: 2026 }, r.points);
  expect(months).toHaveLength(12);
  expect(months[9]).toMatchObject({
    date: "2026-10-01",
    value: "-8.31",
    complete: false,
    expected: 31,
  });
  expect(months[8].value).toBeNull();
});
