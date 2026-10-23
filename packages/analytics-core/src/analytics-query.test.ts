let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { expect, it } from "vitest";
import {
  copilotAnalyticsQuerySchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import {
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
  type AnalyticsQueryProduct,
} from "./analytics-query";
const storeId = randomUUID();
const product = (
  label: string,
  extra: Partial<AnalyticsQueryProduct> = {},
): AnalyticsQueryProduct => ({
  id: randomUUID(),
  label,
  category: "FRUIT",
  nature: "BULK",
  ...extra,
});
const point = (
  id: string,
  value: string | null,
  date = "2025-10-01",
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" = "AVAILABLE",
): AnalyticsQueryPoint => ({
  storeId,
  productId: id,
  businessDate: date,
  sales: { value, status },
  margin: { value, status },
  waste: { value, status },
});
const query = (
  extra: Partial<CopilotAnalyticsQuery> = {},
): CopilotAnalyticsQuery => ({
  currentPeriod: { start: "2025-10-01", end: "2025-10-03" },
  referencePeriod: null,
  groupBy: "PRODUCT",
  metrics: ["sales"],
  aggregation: "SUM",
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
  ...extra,
});
it("exposes requested product sales totals and weighted prices for independent periods without changing a daily-average monetary query", () => {
  const a = product("BANANE"),
    q = query({
      includeSalesMeasures: true,
      aggregation: "AVERAGE",
      referencePeriod: { start: "2024-10-01", end: "2024-10-01" },
    });
  const r = executeAnalyticsQuery({
    storeId,
    query: q,
    products: [a],
    points: [
      {
        ...point(a.id, "10.00"),
        soldQuantity: { value: "2", status: "AVAILABLE" },
        quantityUnit: "KG",
      },
      {
        ...point(a.id, "30.00", "2025-10-02"),
        soldQuantity: { value: "3", status: "AVAILABLE" },
        quantityUnit: "KG",
      },
      {
        ...point(a.id, "12.00", "2024-10-01"),
        soldQuantity: { value: "2", status: "AVAILABLE" },
        quantityUnit: "KG",
      },
    ],
  });
  expect(r.rows[0]).toMatchObject({
    metrics: [{ current: "20.00" }],
    salesMeasures: {
      current: {
        quantity: { value: "5", status: "PARTIAL" },
        averageRealizedPrice: { value: "8.00" },
      },
      reference: {
        quantity: { value: "2", status: "AVAILABLE" },
        averageRealizedPrice: { value: "6.00" },
      },
    },
  });
});
it("preserves existing query results when sales measures were not requested and bounds detailed product pages", () => {
  const a = product("POIRE"),
    r = executeAnalyticsQuery({
      storeId,
      products: [a],
      query: query(),
      points: [point(a.id, "2")],
    });
  expect(r.rows[0]).not.toHaveProperty("salesMeasures");
  for (const extra of [
    { groupBy: "CATEGORY" as const },
    { limit: 11 },
    {
      metrics: ["margin"] as const,
      sort: {
        metric: "margin" as const,
        value: "CURRENT" as const,
        direction: "DESC" as const,
      },
    },
  ]) {
    expect(
      copilotAnalyticsQuerySchema.safeParse({
        ...query(),
        includeSalesMeasures: true,
        ...extra,
      }).success,
    ).toBe(false);
  }
});
it("keeps a known quantity usable even when the sales amount and realized price are unavailable", () => {
  const a = product("POIRE"),
    r = executeAnalyticsQuery({
      storeId,
      products: [a],
      query: query({ includeSalesMeasures: true }),
      points: [
        {
          ...point(a.id, null),
          soldQuantity: { value: "2.500", status: "AVAILABLE" },
          quantityUnit: "KG",
        },
      ],
    });
  expect(r.knownGroups).toBe(1);
  expect(r.rows[0]!.salesMeasures!.current).toMatchObject({
    quantity: { value: "2.500", status: "PARTIAL" },
    averageRealizedPrice: { value: null, status: "UNAVAILABLE" },
  });
});
it("ranks every product before pagination, keeps precise totals and usable partial coverage", () => {
  const a = product("BANANE VRAC"),
    b = product("POIRE"),
    c = product("POMME");
  const run = (offset: number) =>
    executeAnalyticsQuery({
      storeId,
      products: [a, b, c],
      query: query({ offset, limit: 1 }),
      points: [
        point(a.id, "0.10"),
        point(a.id, "0.20", "2025-10-02"),
        point(b.id, "12.00"),
        point(c.id, "5.00"),
      ],
    });
  expect(run(0)).toMatchObject({
    totalGroups: 3,
    hasMore: true,
    nextOffset: 1,
    rows: [
      {
        key: b.id,
        metrics: [
          {
            current: "12.00",
            currentCoverage: { availableDays: 1, missingDays: 2 },
          },
        ],
      },
    ],
  });
  expect(run(1).rows[0]!.key).toBe(c.id);
  expect(run(2)).toMatchObject({
    hasMore: false,
    nextOffset: null,
    rows: [{ key: a.id, metrics: [{ current: "0.30" }] }],
  });
});
it("compares arbitrary periods with shared exact deltas, negative values and unknown zero-baseline percentages", () => {
  const a = product("BANANE"),
    b = product("POIRE");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a, b],
    query: query({
      referencePeriod: { start: "2024-01-01", end: "2024-01-02" },
      having: null,
      sort: { metric: "sales", value: "CHANGE", direction: "ASC" },
    }),
    points: [
      point(a.id, "5.00"),
      point(a.id, "10.00", "2024-01-01"),
      point(b.id, "0.00"),
      point(b.id, "0.00", "2024-01-01"),
    ],
  });
  expect(r.rows[0]).toMatchObject({
    key: a.id,
    metrics: [
      {
        current: "5.00",
        reference: "10.00",
        change: "-5.00",
        changePercent: "-50.00",
        warnings: expect.arrayContaining(["DIFFERENT_PERIOD_LENGTHS"]),
      },
    ],
  });
  expect(r.rows[1]!.metrics[0]).toMatchObject({
    change: "0.00",
    changePercent: null,
    warnings: expect.arrayContaining(["ZERO_REFERENCE"]),
  });
});
it("supports multi-metric category and nature groups using current metadata without hiding unknown classification", () => {
  const a = product("BANANE"),
    b = product("CAROTTE", { category: "VEGETABLE", nature: "PACKAGED" });
  const orphan = randomUUID();
  const r = executeAnalyticsQuery({
    storeId,
    products: [a, b],
    query: query({
      groupBy: "CATEGORY",
      metrics: ["sales", "margin", "waste"],
    }),
    points: [point(a.id, "10"), point(b.id, "4"), point(orphan, "1")],
  });
  expect(r.rows.map((r) => [r.key, r.label, r.metrics[0]!.current])).toEqual([
    ["FRUIT", "Fruits", "10"],
    ["VEGETABLE", "Légumes", "4"],
    ["UNKNOWN", "Catégorie à préciser", "1"],
  ]);
  const n = executeAnalyticsQuery({
    storeId,
    products: [a, b],
    query: query({ groupBy: "NATURE" }),
    points: [point(a.id, "10"), point(b.id, "4")],
  });
  expect(n.rows.map((r) => r.label)).toEqual(["Vrac", "Conditionné"]);
});
it("uses literal accent-insensitive name filters as an analytical set, and combines them with metadata/ID filters", () => {
  const a = product("PÊCHE VRAC"),
    b = product("PECHE BARQUETTE", { nature: "PACKAGED" });
  const filters = { ...query().filters, labelContains: "peche" };
  const run = (f = filters) =>
    executeAnalyticsQuery({
      storeId,
      products: [a, b],
      query: query({ filters: f }),
      points: [point(a.id, "1"), point(b.id, "2")],
    });
  expect(run().totalGroups).toBe(2);
  expect(run({ ...filters, nature: "BULK" }).rows[0]!.key).toBe(a.id);
  expect(run({ ...filters, labelContains: ".*" }).totalGroups).toBe(0);
});
it("keeps known zero, negative amounts, null and unavailable values distinct", () => {
  const a = product("ZERO"),
    b = product("NEGATIVE"),
    c = product("UNKNOWN"),
    d = product("UNAVAILABLE");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a, b, c, d],
    query: query(),
    points: [
      point(a.id, "0.00"),
      point(b.id, "-1.00"),
      point(c.id, null),
      point(d.id, "999", "2025-10-01", "UNAVAILABLE"),
    ],
  });
  expect(r.rows.slice(0, 2).map((r) => r.metrics[0]!.current)).toEqual([
    "0.00",
    "-1.00",
  ]);
  expect(r.rows.slice(2).map((r) => r.metrics[0]!.current)).toEqual([
    null,
    null,
  ]);
});
it("fills missing days as unknown in chronological daily tables and does not mix them into averages", () => {
  const a = product("BANANE");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a],
    query: query({
      groupBy: "DAY",
      having: null,
      sort: { metric: "sales", value: "GROUP", direction: "ASC" },
    }),
    points: [point(a.id, "10")],
  });
  expect(r.rows.map((r) => [r.key, r.metrics[0]!.current])).toEqual([
    ["2025-10-01", "10"],
    ["2025-10-02", null],
    ["2025-10-03", null],
  ]);
  expect(r.rows[1]!.metrics[0]!.currentCoverage.missingDays).toBe(1);
  expect(
    executeAnalyticsQuery({
      storeId,
      products: [a],
      query: query({ aggregation: "AVERAGE" }),
      points: [point(a.id, "10"), point(a.id, "20", "2025-10-02")],
    }).rows[0]!.metrics[0]!.current,
  ).toBe("15");
});
it("qualifies missing product-days inside aggregates, preserving observed sums rather than manufacturing zeros", () => {
  const a = product("A"),
    b = product("B");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a, b],
    query: query({ groupBy: "TOTAL" }),
    points: [point(a.id, "10"), point(b.id, "5", "2025-10-02")],
  });
  expect(r.rows[0]!.metrics[0]).toMatchObject({
    current: "15",
    currentCoverage: { availableDays: 0, partialDays: 2, missingDays: 1 },
  });
});
it("handles annual/leap-year periods without J-7 restrictions", () => {
  const a = product("A");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a],
    query: query({ currentPeriod: { start: "2024-01-01", end: "2024-12-31" } }),
    points: [point(a.id, "100", "2024-02-29")],
  });
  expect(r.rows[0]!.metrics[0]!.currentCoverage).toMatchObject({
    expectedDays: 366,
    availableDays: 1,
    missingDays: 365,
  });
});
it("rejects foreign/duplicate/out-of-period/malformed points and operator/authority injection", () => {
  const a = product("A"),
    p = point(a.id, "1");
  const run = (points: AnalyticsQueryPoint[]) =>
    executeAnalyticsQuery({ storeId, products: [a], query: query(), points });
  for (const points of [
    [p, p],
    [{ ...p, storeId: randomUUID() }],
    [point(a.id, "1", "2025-09-01")],
    [point(a.id, "NaN")],
  ])
    expect(() => run(points)).toThrow();
  for (const extra of [
    { storeId },
    { collection: "users" },
    { pipeline: [{ $out: "products" }] },
    { filters: { ...query().filters, labelContains: { $ne: null } } },
  ])
    expect(
      copilotAnalyticsQuerySchema.safeParse({ ...query(), ...extra }).success,
    ).toBe(false);
  expect(
    copilotAnalyticsQuerySchema.safeParse(
      query({
        referencePeriod: null,
        having: null,
        sort: { metric: "sales", value: "CHANGE", direction: "DESC" },
      }),
    ).success,
  ).toBe(false);
});
it("fails explicitly instead of ranking a truncated or excessive analytical grid", () => {
  const products = Array.from({ length: 600 }, () => product("A"));
  expect(() =>
    executeAnalyticsQuery({
      storeId,
      products,
      query: query({
        currentPeriod: { start: "2016-01-01", end: "2025-12-31" },
      }),
      points: products.map((p) => point(p.id, "1")),
    }),
  ).toThrow("ANALYTICS_QUERY_LIMIT_EXCEEDED");
});

it("filters computed groups by exact numeric conditions before ranking, excluding unknowns", () => {
  const a = product("LOSS"),
    b = product("GAIN"),
    c = product("UNKNOWN");
  const r = executeAnalyticsQuery({
    storeId,
    products: [a, b, c],
    query: query({
      having: {
        metric: "sales",
        value: "CHANGE",
        operator: "LT",
        threshold: "0",
      },
      referencePeriod: { start: "2024-10-01", end: "2024-10-01" },
    }),
    points: [
      point(a.id, "5"),
      point(a.id, "10", "2024-10-01"),
      point(b.id, "15"),
      point(b.id, "10", "2024-10-01"),
      point(c.id, null),
    ],
  });
  expect(r.totalGroups).toBe(1);
  expect(r.evaluatedGroups).toBe(3);
  expect(r.unknownConditionGroups).toBe(1);
  expect(r.rows[0]!.key).toBe(a.id);
  expect(r.rows[0]!.metrics[0]!.change).toBe("-5");
});
