import { expect, it } from "vitest";
import {
  compareExplorerPeriod,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import {
  productMetricDetail,
  productCoverageLabel,
} from "./product-performance-presentation";
it("shows the absolute comparison when a zero baseline makes the percentage unavailable", () => {
  const period: ExplorerPeriod = { kind: "day", date: "2026-10-15" };
  const value = compareExplorerPeriod({
    period,
    today: "2026-10-20",
    kpiId: "sales",
    points: [
      { businessDate: "2026-10-15", value: "2.00", status: "AVAILABLE" },
      { businessDate: "2025-10-16", value: "0.00", status: "AVAILABLE" },
    ],
  });
  expect(value.comparison?.percentageDifference).toBeNull();
  expect(productMetricDetail(value, period)).toContain("+2,00");
  expect(productMetricDetail(value, period)).not.toContain("%");
  expect(productMetricDetail(value, period)).not.toContain("indisponible");
});
it("labels unavailable data independently of partial and zero results, and keeps explicit daily averages distinct from totals", () => {
  const period: ExplorerPeriod = {
    kind: "range",
    current: { start: "2026-10-01", end: "2026-10-03" },
    reference: null,
    aggregation: "AVERAGE",
    basis: "OBSERVED_PRODUCTS",
  };
  const value = compareExplorerPeriod({
    period,
    today: "2026-10-20",
    kpiId: "sales",
    points: [{ businessDate: "2026-10-01", value: "0", status: "PARTIAL" }],
  });
  expect(productMetricDetail(value, period)).toMatch(/^Moyenne partielle/);
  expect(productMetricDetail({ ...value, total: null }, period)).toBe(
    "Sans donnée",
  );
  expect(productMetricDetail(undefined, period)).toBe("Lecture locale…");
  expect(productCoverageLabel(value.coverage)).toBe(
    "0 jours complets · 1 partiel · 2 sans donnée",
  );
});
