let nextId = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
import { expect, it } from "vitest";
import type { CopilotAnalyticsQuery } from "@fl-copilot/domain";
import {
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
} from "./analytics-query";
import { buildAnalyticsQueryChart } from "./analytics-query-chart";
import { resolveCopilotComparison } from "./copilot-comparison-period";
const storeId = randomUUID(),
  id = randomUUID();
const products = [
  { id, label: "BANANE", category: "FRUIT" as const, nature: "BULK" as const },
];
const base: CopilotAnalyticsQuery = {
  currentPeriod: { start: "2026-10-01", end: "2026-10-03" },
  referencePeriod: { start: "2025-10-01", end: "2025-10-03" },
  groupBy: "TOTAL",
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
};
const point = (businessDate: string, value: string): AnalyticsQueryPoint => ({
  storeId,
  productId: id,
  businessDate,
  sales: { value, status: "AVAILABLE" },
  margin: { value: null, status: "UNAVAILABLE" },
  waste: { value: null, status: "UNAVAILABLE" },
});
it("uses canonical ISO day pairs, preserving zero, missing values and negative values", () => {
  const query = resolveCopilotComparison({
    ...base,
    chart: { type: "LINE" as const, measure: "CURRENT_REFERENCE" as const },
  });
  const input = {
    storeId,
    query,
    products,
    points: [
      point("2026-10-01", "0"),
      point("2026-10-03", "-5"),
      point("2025-10-02", "8"),
      point("2025-10-04", "2"),
    ],
  };
  const chart = buildAnalyticsQueryChart({
    ...input,
    result: executeAnalyticsQuery(input),
  })!;
  expect(chart.labels).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  expect(chart.series[0]!.points.map((p) => p.value)).toEqual([
    "0",
    null,
    "-5",
  ]);
  expect(chart.series[1]!.points.map((p) => p.value)).toEqual(["8", null, "2"]);
  expect(chart.series[1]!.period).toEqual({
    start: "2025-10-02",
    end: "2025-10-04",
  });
});
it("plots the returned ranking's exact euro difference and does not fabricate missing groups", () => {
  const query = resolveCopilotComparison({
    ...base,
    groupBy: "PRODUCT" as const,
    chart: { type: "BARS" as const, measure: "CHANGE" as const },
  });
  const input = {
    storeId,
    query,
    products,
    points: [point("2026-10-01", "5"), point("2025-10-02", "8")],
  };
  const result = executeAnalyticsQuery(input),
    chart = buildAnalyticsQueryChart({ ...input, result })!;
  expect(chart.labels).toEqual(["BANANE"]);
  expect(chart.series[0]!.points[0]!.value).toBe(
    result.rows[0]!.metrics[0]!.change,
  );
  expect(chart.series[0]!.points[0]!.status).toBe("PARTIAL");
});
it("rejects a temporal chart across unequal custom periods while preserving the underlying analysis", () => {
  const query: CopilotAnalyticsQuery = {
    ...base,
    referenceMode: "CUSTOM",
    referencePeriod: { start: "2025-10-01", end: "2025-10-01" },
    chart: { type: "LINE", measure: "CURRENT_REFERENCE" },
  };
  const input = {
    storeId,
    query,
    products,
    points: [point("2026-10-01", "5"), point("2025-10-01", "8")],
  };
  expect(
    buildAnalyticsQueryChart({
      ...input,
      result: executeAnalyticsQuery(input),
    }),
  ).toBeUndefined();
});

it.each(["QUANTITY", "REALIZED_PRICE"] as const)(
  "plots canonical recorded %s without mixing units or averaging daily prices",
  (value) => {
    const points = [
      {
        ...point("2026-10-01", "10"),
        soldQuantity: { value: "2", status: "AVAILABLE" as const },
        quantityUnit: "KG" as const,
      },
      {
        ...point("2026-10-03", "30"),
        soldQuantity: { value: "3", status: "AVAILABLE" as const },
        quantityUnit: "KG" as const,
      },
    ];
    const query: CopilotAnalyticsQuery = {
      ...base,
      referencePeriod: null,
      groupBy: "PRODUCT",
      includeSalesMeasures: true,
      filters: { ...base.filters, productIds: [id] },
      chart: { type: "BARS", measure: "CURRENT", value },
    };
    const input = { storeId, query, products, points };
    const bars = buildAnalyticsQueryChart({
      ...input,
      result: executeAnalyticsQuery(input),
    })!;
    expect(bars.unit).toBe(value === "QUANTITY" ? "KG" : "EUR_PER_KG");
    expect(bars.series[0]!.points[0]!.value).toBe(
      value === "QUANTITY" ? "5" : "8.00",
    );
    const trendInput = {
      ...input,
      query: { ...query, chart: { ...query.chart!, type: "LINE" as const } },
    };
    const line = buildAnalyticsQueryChart({
      ...trendInput,
      result: executeAnalyticsQuery(trendInput),
    })!;
    expect(line.series[0]!.points.map((p) => p.value)).toEqual(
      value === "QUANTITY" ? ["2", null, "3"] : ["5.00", null, "10.00"],
    );
  },
);
it("refuses a quantity plot combining kilograms and pieces", () => {
  const secondId = randomUUID();
  const query: CopilotAnalyticsQuery = {
    ...base,
    referencePeriod: null,
    groupBy: "PRODUCT",
    includeSalesMeasures: true,
    chart: { type: "BARS", measure: "CURRENT", value: "QUANTITY" },
  };
  const input = {
    storeId,
    query,
    products: [...products, { ...products[0]!, id: secondId }],
    points: [
      {
        ...point("2026-10-01", "10"),
        soldQuantity: { value: "2", status: "AVAILABLE" as const },
        quantityUnit: "KG" as const,
      },
      {
        ...point("2026-10-01", "20"),
        productId: secondId,
        soldQuantity: { value: "3", status: "AVAILABLE" as const },
        quantityUnit: "PIECE" as const,
      },
    ],
  };
  expect(
    buildAnalyticsQueryChart({
      ...input,
      result: executeAnalyticsQuery(input),
    }),
  ).toBeUndefined();
});

it("plots all 31 dates across both canonical daily pages", () => {
  const query: CopilotAnalyticsQuery = {
    ...base,
    referencePeriod: null,
    currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
    chart: { type: "LINE", measure: "CURRENT" },
  };
  const points = Array.from({ length: 31 }, (_, i) =>
    point(`2026-10-${String(i + 1).padStart(2, "0")}`, String(i)),
  );
  const input = { storeId, query, products, points };
  const chart = buildAnalyticsQueryChart({
    ...input,
    result: executeAnalyticsQuery(input),
  })!;
  expect(chart.labels).toHaveLength(31);
  expect(chart.series[0]!.points.map((p) => p.value)).toEqual(
    points.map((p) => p.sales.value),
  );
  expect(chart.labels.at(-1)).toBe("2026-10-31");
});
