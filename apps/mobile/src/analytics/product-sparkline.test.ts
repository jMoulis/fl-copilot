import { expect, it } from "vitest";
import type { DatedKpiValue, ExplorerPeriod } from "@fl-copilot/analytics-core";
import { productSparkline } from "./product-sparkline";
const week: ExplorerPeriod = { kind: "week", year: 2026, week: 43 };
const point = (
  businessDate: string,
  value: string | null,
  status: DatedKpiValue["status"] = "AVAILABLE",
): DatedKpiValue => ({ businessDate, value, status });
it("leaves a break across missing and unavailable days instead of inventing a zero or joining the gap", () => {
  const plot = productSparkline(week, [
    point("2026-10-19", "10"),
    point("2026-10-20", "20"),
    point("2026-10-21", "99", "UNAVAILABLE"),
    point("2026-10-22", "0"),
    point("2026-10-23", "5", "PARTIAL"),
  ]);
  expect(plot.available).toBe(4);
  expect(plot.expected).toBe(7);
  expect(plot.segments).toHaveLength(2);
  expect(plot.segments.map((s) => s.complete)).toEqual([true, false]);
  expect(plot.segments[1]!.x).toBeGreaterThan(plot.segments[0]!.x + 15);
});
it.each(["0", "-20", "80"])(
  "keeps a constant %s series finite and horizontal",
  (value) => {
    const plot = productSparkline(week, [
      point("2026-10-19", value),
      point("2026-10-20", value),
    ]);
    expect(plot.segments[0]!.angle).toBe(0);
    expect(plot.segments[0]!.y).toBe(15);
  },
);
it("keeps negative amounts below positive ones without clipping or reversing the trend", () => {
  const p = productSparkline(week, [
    point("2026-10-19", "-20"),
    point("2026-10-20", "0"),
    point("2026-10-21", "20"),
  ]);
  expect(p.segments).toHaveLength(2);
  expect(p.segments.every((s) => s.angle < 0)).toBe(true);
  expect(p.segments[0]!.y).toBe(27);
  expect(p.segments[1]!.y).toBe(15);
});
it("shows one daily observation as a dot without an invented hourly trend", () => {
  const p = productSparkline({ kind: "day", date: "2026-10-19" }, [
    point("2026-10-19", "10"),
  ]);
  expect(p.segments).toHaveLength(0);
  expect(p.isolated).toEqual([{ x: 33, y: 15, complete: true }]);
  expect(p.expected).toBe(1);
});
it("keeps an empty week unknown with no plotted observations", () => {
  const p = productSparkline(week, []);
  expect(p.available).toBe(0);
  expect(p.segments).toEqual([]);
  expect(p.isolated).toEqual([]);
});
it("uses canonical monthly bins for a year and preserves empty months", () => {
  const p = productSparkline({ kind: "year", year: 2026 }, [
    point("2026-01-01", "10"),
    point("2026-01-02", "20"),
    point("2026-03-01", "40"),
  ]);
  expect(p.expected).toBe(12);
  expect(p.available).toBe(2);
  expect(p.segments).toHaveLength(0);
  expect(p.isolated).toHaveLength(2);
});
it("retains the explicit-period daily-mean policy in broad monthly bins", () => {
  const period: ExplorerPeriod = {
    kind: "range",
    current: { start: "2026-01-01", end: "2026-04-01" },
    reference: null,
    aggregation: "AVERAGE",
    basis: "OBSERVED_PRODUCTS",
  };
  const p = productSparkline(period, [
    point("2026-01-01", "10"),
    point("2026-01-02", "30"),
    point("2026-02-01", "20"),
  ]);
  expect(p.segments).toHaveLength(1);
  expect(p.segments[0]!.angle).toBe(0);
});
