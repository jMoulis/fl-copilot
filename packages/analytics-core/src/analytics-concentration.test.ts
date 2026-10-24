import { expect, it } from "vitest";
import {
  copilotAnalyticsQuerySchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import {
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
} from "./analytics-query";
const storeId = "00000000-0000-4000-8000-000000000001";
function fixture(
  values: Array<string | null>,
  reference?: Array<string | null>,
) {
  const products = values.map((_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 2).padStart(12, "0")}`,
    label: `Produit ${i}`,
    category: "FRUIT" as const,
    nature: "BULK" as const,
  }));
  const points: AnalyticsQueryPoint[] = values.flatMap((value, i) => {
    const point = (v: string | null, date: string): AnalyticsQueryPoint => ({
      storeId,
      productId: products[i]!.id,
      businessDate: date,
      sales: { value: v, status: v === null ? "UNAVAILABLE" : "AVAILABLE" },
      margin: { value: null, status: "UNAVAILABLE" },
      waste: { value: null, status: "UNAVAILABLE" },
    });
    return [
      point(value, "2026-10-01"),
      ...(reference ? [point(reference[i]!, "2025-10-02")] : []),
    ];
  });
  const query = {
    currentPeriod: { start: "2026-10-01", end: "2026-10-01" },
    referencePeriod: reference
      ? { start: "2025-10-02", end: "2025-10-02" }
      : null,
    groupBy: "PRODUCT",
    metrics: ["sales"],
    aggregation: "SUM",
    includeSalesConcentration: true,
    filters: {
      productIds: null,
      labelContains: null,
      category: null,
      nature: null,
    },
    having: null,
    sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
    offset: 0,
    limit: 10,
  } as CopilotAnalyticsQuery;
  const run = (extra: Partial<CopilotAnalyticsQuery> = {}) =>
    executeAnalyticsQuery({
      storeId,
      products,
      points,
      query: { ...query, ...extra },
    });
  return { products, points, query, run };
}
it("calculates the actual Pareto of all hundred products before ten-row pagination, with an independent reference distribution", () => {
  const f = fixture(
    Array.from({ length: 100 }, (_, i) => (i < 20 ? "4.00" : "0.25")),
    Array(100).fill("1.00"),
  );
  const r = f.run();
  expect(r.rows).toHaveLength(10);
  expect(r.salesConcentration?.current).toMatchObject({
    status: "AVAILABLE",
    availableProductCount: 100,
    missingProductCount: 0,
    totalSalesValue: "100.00",
    top20ProductCount: 20,
    top20SalesSharePercent: "80.00",
    productsFor80Percent: 20,
    productShareFor80Percent: "20.00",
    actualSalesShareFor80Percent: "80.00",
  });
  expect(r.salesConcentration?.reference).toMatchObject({
    top20SalesSharePercent: "20.00",
    productsFor80Percent: 80,
    productShareFor80Percent: "80.00",
  });
  expect(f.run({ offset: 40 }).salesConcentration).toEqual(
    r.salesConcentration,
  );
});
it("uses ceiling for the top fifth and includes the row crossing eighty percent", () => {
  expect(
    fixture(["40.00", "30.00", "20.00", "10.00"]).run().salesConcentration
      ?.current,
  ).toMatchObject({
    top20ProductCount: 1,
    top20SalesSharePercent: "40.00",
    productsFor80Percent: 3,
    productShareFor80Percent: "75.00",
    actualSalesShareFor80Percent: "90.00",
  });
});
it("compares exact decimal thresholds before rounding", () => {
  expect(
    fixture(["0.80", "0.10", "0.10"]).run().salesConcentration?.current,
  ).toMatchObject({
    totalSalesValue: "1.00",
    productsFor80Percent: 1,
    actualSalesShareFor80Percent: "80.00",
  });
});
it("preserves unknown and partial groups instead of calling them zero or certifying complete department coverage", () => {
  const f = fixture(["80.00", null, "20.00"]);
  f.points[0]!.sales.status = "PARTIAL";
  expect(f.run().salesConcentration?.current).toMatchObject({
    status: "PARTIAL",
    availableProductCount: 2,
    missingProductCount: 1,
    partialProductCount: 1,
    totalSalesValue: "100.00",
    productsFor80Percent: 1,
  });
});
it.each([
  ["0.00", "0.00"],
  [null, null],
])("does not divide an unavailable or zero total", (a, b) => {
  expect(fixture([a, b]).run().salesConcentration?.current).toMatchObject({
    status: "UNAVAILABLE",
    top20SalesSharePercent: null,
    productsFor80Percent: null,
    productShareFor80Percent: null,
  });
});
it("keeps negative net sales explicit and refuses misleading Pareto percentages", () => {
  expect(
    fixture(["10.00", "-1.00"]).run().salesConcentration?.current,
  ).toMatchObject({
    status: "UNAVAILABLE",
    reason: "NEGATIVE_SALES",
    negativeProductCount: 1,
    totalSalesValue: "9.00",
    top20SalesSharePercent: null,
    productsFor80Percent: null,
  });
});
it("calculates only the actual filtered analytical cohort", () => {
  const f = fixture(["80.00", "20.00", "900.00"]);
  expect(
    f.run({
      filters: {
        ...f.query.filters,
        productIds: f.products.slice(0, 2).map((p) => p.id),
      },
    }).salesConcentration?.current,
  ).toMatchObject({
    availableProductCount: 2,
    totalSalesValue: "100.00",
    productsFor80Percent: 1,
  });
});
it("preserves the exact old result envelope when concentration was not requested", () => {
  const f = fixture(["80.00", "20.00"]);
  expect(f.run({ includeSalesConcentration: undefined })).not.toHaveProperty(
    "salesConcentration",
  );
});
it("rejects average, non-product, mixed metrics and having-filter concentration rather than presenting a selected page as a whole cohort", () => {
  const { query } = fixture(["1.00"]);
  for (const extra of [
    { aggregation: "AVERAGE" },
    { groupBy: "TOTAL" },
    { metrics: ["sales", "margin"] },
    {
      having: {
        metric: "sales",
        value: "CURRENT",
        operator: "GT",
        threshold: "0",
      },
    },
  ])
    expect(
      copilotAnalyticsQuerySchema.safeParse({ ...query, ...extra }).success,
    ).toBe(false);
});
