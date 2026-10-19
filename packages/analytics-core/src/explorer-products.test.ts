import { it, expect } from "vitest";
import { emptyExplorerFilters } from "@fl-copilot/domain";
import { analyzeExplorerProducts } from "./explorer-products";
import {
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
} from "./analytics-query";
import { explorerMonthWeeks, explorerRange } from "./explorer-period";
const storeId = "00000000-0000-4000-8000-000000000001";
const ids = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const products = ids.map((id, i) => ({
  id,
  label: i ? "Tomate" : "Poire",
  category: i ? ("VEGETABLE" as const) : ("FRUIT" as const),
  nature: i ? ("PACKAGED" as const) : ("BULK" as const),
}));
const point = (
  productId: string,
  businessDate: string,
  value: string | null,
  status: AnalyticsQueryPoint["sales"]["status"] = "AVAILABLE",
): AnalyticsQueryPoint => ({
  storeId,
  productId,
  businessDate,
  sales: { value, status },
  margin: { value, status },
  waste: { value, status },
});
const base = {
  storeId,
  products,
  period: { kind: "day" as const, date: "2026-10-15" },
  today: "2026-10-19",
  metric: "sales" as const,
  filters: emptyExplorerFilters(),
};
it("shares exact query arithmetic and filters current category/nature/identity without interpreting source channel", () => {
  const points = [
    point(ids[0], "2026-10-15", "10.01"),
    point(ids[1], "2026-10-15", "2.22"),
    point(ids[0], "2025-10-16", "5"),
    point(ids[1], "2025-10-16", "2"),
  ];
  const r = analyzeExplorerProducts({ ...base, points });
  expect(r.analysis.total).toBe("12.23");
  expect(r.analysis.comparison?.referenceValue).toBe("7");
  const q = executeAnalyticsQuery({
    storeId,
    products,
    points,
    query: {
      currentPeriod: { start: "2026-10-15", end: "2026-10-15" },
      referencePeriod: { start: "2025-10-16", end: "2025-10-16" },
      metrics: ["sales"],
      groupBy: "TOTAL",
      aggregation: "SUM",
      filters: {
        category: null,
        nature: null,
        productIds: null,
        labelContains: null,
      },
      having: null,
      sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
      offset: 0,
      limit: 20,
    },
  });
  expect(q.rows[0].metrics[0].current).toBe(r.analysis.total);
  const f = analyzeExplorerProducts({
    ...base,
    points,
    filters: { category: "VEGETABLE", nature: "PACKAGED", productId: null },
  });
  expect(f.analysis.total).toBe("2.22");
  expect(f.contributors.map((p) => p.productId)).toEqual([ids[1]]);
  expect(
    analyzeExplorerProducts({
      ...base,
      points,
      filters: { category: null, nature: "BULK", productId: ids[1] },
    }).analysis.total,
  ).toBeNull();
});
it("retains the same observed product universe on both sides and refuses an absent product-day instead of a false baseline", () => {
  const r = analyzeExplorerProducts({
    ...base,
    points: [
      point(ids[0], "2026-10-15", "10"),
      point(ids[1], "2026-10-15", "20"),
      point(ids[0], "2025-10-16", "5"),
    ],
  });
  expect(r.analysis.comparison).toBeNull();
  expect(r.analysis.total).toBe("30.00");
  expect(
    r.contributors.find((p) => p.productId === ids[0])?.analysis.comparison
      ?.absoluteDifference,
  ).toBe("5");
  expect(
    r.contributors.find((p) => p.productId === ids[1])?.analysis.comparison,
  ).toBeNull();
});
it("preserves negative, zero, partial and unavailable amounts and does not hide losses", () => {
  const r = analyzeExplorerProducts({
    ...base,
    metric: "margin",
    points: [
      point(ids[0], "2026-10-15", "-12.31", "PARTIAL"),
      point(ids[1], "2026-10-15", "0"),
    ],
  });
  expect(r.analysis.total).toBe("-12.31");
  expect(r.analysis.coverage.partial).toBe(1);
  expect(r.contributors.map((p) => p.analysis.total)).toEqual([
    "0.00",
    "-12.31",
  ]);
  expect(
    analyzeExplorerProducts({
      ...base,
      points: [point(ids[0], "2026-10-15", null)],
    }).contributors,
  ).toEqual([]);
});
it("paginates after exact ranking and preserves unknown catalogue observations only in the unfiltered scope", () => {
  const p = Array.from({ length: 25 }, (_, i) => ({
    ...products[0],
    id: `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
  }));
  const points = p.map((p, i) => point(p.id, "2026-10-15", String(i)));
  const first = analyzeExplorerProducts({ ...base, products: p, points });
  expect(first.totalContributors).toBe(25);
  expect(first.contributors).toHaveLength(20);
  expect(first.nextOffset).toBe(20);
  const next = analyzeExplorerProducts({
    ...base,
    products: p,
    points,
    offset: 20,
  });
  expect(next.contributors).toHaveLength(5);
  expect(next.nextOffset).toBeNull();
  expect(next.contributors.at(-1)?.analysis.total).toBe("0.00");
  const unknown = analyzeExplorerProducts({
    ...base,
    products: [],
    points: [point(ids[0], "2026-10-15", "7")],
  });
  expect(unknown.categories[0].category).toBe("UNKNOWN");
  expect(unknown.contributors[0].label).toBe("Produit à identifier");
  expect(
    analyzeExplorerProducts({
      ...base,
      products: [],
      points: [point(ids[0], "2026-10-15", "7")],
      filters: { category: "UNKNOWN", nature: null, productId: null },
    }).analysis.total,
  ).toBeNull();
});
it("refuses foreign/duplicate point identity, catalogue duplicates and invalid pagination", () => {
  const p = point(ids[0], "2026-10-15", "1");
  expect(() => analyzeExplorerProducts({ ...base, points: [p, p] })).toThrow(
    "SCOPE",
  );
  expect(() =>
    analyzeExplorerProducts({ ...base, points: [{ ...p, storeId: ids[1] }] }),
  ).toThrow("SCOPE");
  expect(() =>
    analyzeExplorerProducts({
      ...base,
      points: [{ ...p, businessDate: "2020-01-01" }],
    }),
  ).toThrow("SCOPE");
  expect(() =>
    analyzeExplorerProducts({
      ...base,
      points: [],
      products: [products[0], products[0]],
    }),
  ).toThrow("DUPLICATE");
  expect(() =>
    analyzeExplorerProducts({ ...base, points: [], offset: -1 }),
  ).toThrow("OFFSET");
});
it("enumerates intersecting ISO weeks with complete cross-month/year ranges", () => {
  const weeks = explorerMonthWeeks({ kind: "month", year: 2021, month: 1 });
  expect(weeks[0]).toEqual({ kind: "week", year: 2020, week: 53 });
  expect(explorerRange(weeks[0])).toEqual({
    start: "2020-12-28",
    end: "2021-01-03",
  });
  expect(explorerRange(weeks.at(-1)!)).toEqual({
    start: "2021-01-25",
    end: "2021-01-31",
  });
  expect(weeks).toHaveLength(5);
});
it("ranks daily means by means rather than sums and keeps a declared observed universe incomplete", () => {
  const period = {
    kind: "range" as const,
    current: { start: "2026-10-01", end: "2026-10-03" },
    reference: null,
    aggregation: "AVERAGE" as const,
    basis: "OBSERVED_PRODUCTS" as const,
  };
  const r = analyzeExplorerProducts({
    ...base,
    period,
    points: [
      point(ids[0], "2026-10-01", "10"),
      point(ids[0], "2026-10-02", "10"),
      point(ids[0], "2026-10-03", "10"),
      point(ids[1], "2026-10-01", "20"),
    ],
  });
  expect(r.contributors.map((p) => p.productId)).toEqual([ids[1], ids[0]]);
  expect(r.contributors[0].analysis.total).toBe("20");
  const day = analyzeExplorerProducts({
    ...base,
    period: { ...period, current: { start: "2026-10-01", end: "2026-10-01" } },
    expectedProductIds: ids,
    points: [point(ids[0], "2026-10-01", "10")],
  });
  expect(day.analysis.coverage.partial).toBe(1);
  expect(day.analysis.total).toBe("10");
});
