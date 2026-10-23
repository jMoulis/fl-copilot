import { z } from "zod";
import {
  copilotAnalyticsQuerySchema,
  copilotBusinessDateSchema,
  productCategorySchema,
  productNatureSchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import { addDecimals, parseDecimal } from "./decimal";
import { calculateCalendarPeriodComparison } from "./calendar-period-comparison";
import type { DatedKpiValue } from "./comparison";
import { calculateSalesMeasures } from "./sales-measures";
export const ANALYTICS_QUERY_LIMITS = {
  maxProducts: 10000,
  maxPoints: 100000,
  maxCalendarCells: 2000000,
} as const;
const metricSchema = z.strictObject({
  value: z.string().nullable(),
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
});
export const analyticsQueryPointSchema = z.strictObject({
  storeId: z.uuid(),
  productId: z.uuid(),
  businessDate: copilotBusinessDateSchema,
  sales: metricSchema,
  margin: metricSchema,
  waste: metricSchema,
  wasteCost: metricSchema.optional(),
  soldQuantity: metricSchema
    .extend({
      reason: z
        .enum(["MISSING_INPUT", "UNKNOWN_UNIT", "INCOMPATIBLE_UNITS"])
        .optional(),
    })
    .optional(),
  quantityUnit: z
    .enum(["KG", "PIECE", "PACK", "UNKNOWN"])
    .nullable()
    .optional(),
});
export const analyticsQueryProductSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().trim().min(1).max(240),
  category: productCategorySchema,
  nature: productNatureSchema,
});
export type AnalyticsQueryPoint = z.infer<typeof analyticsQueryPointSchema>;
export type AnalyticsQueryProduct = z.infer<typeof analyticsQueryProductSchema>;
export function analyticsLabelContains(label: string, term: string) {
  const normalize = (v: string) =>
    v.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr-FR");
  return normalize(label).includes(normalize(term));
}
export function analyticsProductMatches(
  p: AnalyticsQueryProduct,
  f: CopilotAnalyticsQuery["filters"],
) {
  return (
    (!f.productIds || f.productIds.includes(p.id)) &&
    (!f.labelContains || analyticsLabelContains(p.label, f.labelContains)) &&
    (!f.category || p.category === f.category) &&
    (!f.nature || p.nature === f.nature)
  );
}
/** Shared exact monetary cube. All groups ranked before pagination; null is never zero. */
export function executeAnalyticsQuery(input: {
  storeId: string;
  query: CopilotAnalyticsQuery;
  products: readonly AnalyticsQueryProduct[];
  points: readonly AnalyticsQueryPoint[];
}) {
  z.uuid().parse(input.storeId);
  const query = copilotAnalyticsQuerySchema.parse(input.query);
  if (
    input.products.length > ANALYTICS_QUERY_LIMITS.maxProducts ||
    input.points.length > ANALYTICS_QUERY_LIMITS.maxPoints
  )
    throw Error("ANALYTICS_QUERY_LIMIT_EXCEEDED");
  const products = new Map<string, AnalyticsQueryProduct>();
  for (const raw of input.products) {
    const p = analyticsQueryProductSchema.parse(raw);
    if (products.has(p.id)) throw Error("ANALYTICS_QUERY_DUPLICATE_PRODUCT");
    products.set(p.id, p);
  }
  const hasProductFilter = Object.values(query.filters).some((v) => v !== null);
  const groups = new Map<
    string,
    { label: string; productIds: Set<string>; points: AnalyticsQueryPoint[] }
  >();
  const seen = new Set<string>();
  const universe = new Set<string>();
  const ranges = [
    query.currentPeriod,
    ...(query.referencePeriod ? [query.referencePeriod] : []),
  ];
  for (const raw of input.points) {
    const p = analyticsQueryPointSchema.parse(raw),
      unique = `${p.productId}/${p.businessDate}`;
    if (
      p.storeId !== input.storeId ||
      seen.has(unique) ||
      !ranges.some((r) => p.businessDate >= r.start && p.businessDate <= r.end)
    )
      throw Error("ANALYTICS_QUERY_SCOPE_INVALID");
    seen.add(unique);
    for (const metric of query.metrics)
      if (p[metric].value !== null) parseDecimal(p[metric].value);
    const product = products.get(p.productId);
    if (
      hasProductFilter &&
      (!product || !analyticsProductMatches(product, query.filters))
    )
      continue;
    universe.add(p.productId);
    const key =
      query.groupBy === "PRODUCT"
        ? p.productId
        : query.groupBy === "CATEGORY"
          ? (product?.category ?? "UNKNOWN")
          : query.groupBy === "NATURE"
            ? (product?.nature ?? "UNKNOWN")
            : query.groupBy === "DAY"
              ? p.businessDate
              : "TOTAL";
    const label =
      query.groupBy === "PRODUCT"
        ? (product?.label ?? "Produit à identifier")
        : query.groupBy === "CATEGORY"
          ? (
              {
                FRUIT: "Fruits",
                VEGETABLE: "Légumes",
                OTHER: "Autres",
                UNKNOWN: "Catégorie à préciser",
              } as Record<string, string>
            )[key]!
          : query.groupBy === "NATURE"
            ? (
                {
                  BULK: "Vrac",
                  PACKAGED: "Conditionné",
                  UNKNOWN: "Nature à préciser",
                } as Record<string, string>
              )[key]!
            : query.groupBy === "DAY"
              ? p.businessDate
              : "Ensemble des produits renseignés";
    const group = groups.get(key) ?? {
      label,
      productIds: new Set<string>(),
      points: [],
    };
    group.productIds.add(p.productId);
    group.points.push(p);
    groups.set(key, group);
  }
  if (query.groupBy === "DAY") {
    for (
      let d = Date.parse(query.currentPeriod.start),
        end = Date.parse(query.currentPeriod.end);
      d <= end;
      d += 86400000
    ) {
      const key = new Date(d).toISOString().slice(0, 10);
      if (!groups.has(key))
        groups.set(key, { label: key, productIds: new Set(), points: [] });
    }
  }
  if (
    query.groupBy === "PRODUCT" &&
    groups.size > ANALYTICS_QUERY_LIMITS.maxProducts
  )
    throw Error("ANALYTICS_QUERY_LIMIT_EXCEEDED");
  const days = (p: { start: string; end: string }) =>
    (Date.parse(p.end) - Date.parse(p.start)) / 86400000 + 1;
  if (
    groups.size *
      query.metrics.length *
      (query.groupBy === "DAY"
        ? 1
        : days(query.currentPeriod) +
          (query.referencePeriod ? days(query.referencePeriod) : 0)) >
    ANALYTICS_QUERY_LIMITS.maxCalendarCells
  )
    throw Error("ANALYTICS_QUERY_LIMIT_EXCEEDED");
  let allRows = [...groups].map(([key, group]) => {
    const metrics = query.metrics.map((metric) => {
      const points = aggregateAnalyticsDailyPoints(
        group.points,
        metric,
        query.groupBy === "DAY" ? universe.size : group.productIds.size,
      );
      const currentPeriod =
        query.groupBy === "DAY"
          ? { start: key, end: key }
          : query.currentPeriod;
      const r = calculateCalendarPeriodComparison({
        kpiId: metric,
        currentPeriod,
        referencePeriod: query.referencePeriod,
        aggregation: query.aggregation,
        points,
      });
      return {
        metric,
        current: r.comparison.currentValue,
        reference: r.comparison.referenceValue,
        change: r.comparison.absoluteDifference,
        changePercent: r.comparison.percentageDifference,
        currentCoverage: r.currentCoverage,
        referenceCoverage: r.referenceCoverage,
        warnings: query.referencePeriod ? r.warnings : [],
      };
    });
    return {
      key,
      label: group.label,
      productCount: group.productIds.size,
      metrics,
      ...(query.includeSalesMeasures
        ? {
            salesMeasures: {
              current: calculateSalesMeasures(
                query.currentPeriod,
                group.points,
              ),
              reference: query.referencePeriod
                ? calculateSalesMeasures(query.referencePeriod, group.points)
                : null,
            },
          }
        : {}),
    };
  });
  const sortKey = {
    CURRENT: "current",
    REFERENCE: "reference",
    CHANGE: "change",
    CHANGE_PERCENT: "changePercent",
  } as const;
  const evaluatedGroups = allRows.length;
  let unknownConditionGroups = 0;
  if (query.having) {
    const condition = query.having;
    allRows = allRows.filter((r) => {
      const value = r.metrics.find((m) => m.metric === condition.metric)![
        sortKey[condition.value]
      ];
      if (value === null) {
        unknownConditionGroups++;
        return false;
      }
      const cmp = parseDecimal(value).value.comparedTo(
        parseDecimal(condition.threshold).value,
      );
      return condition.operator === "GT"
        ? cmp > 0
        : condition.operator === "GTE"
          ? cmp >= 0
          : condition.operator === "LT"
            ? cmp < 0
            : cmp <= 0;
    });
  }
  allRows.sort((a, b) => {
    if (query.sort.value === "GROUP") {
      const av = query.groupBy === "DAY" ? a.key : a.label;
      const bv = query.groupBy === "DAY" ? b.key : b.label;
      return (
        (av < bv
          ? -1
          : av > bv
            ? 1
            : a.key < b.key
              ? -1
              : a.key > b.key
                ? 1
                : 0) * (query.sort.direction === "ASC" ? 1 : -1)
      );
    }
    const av = a.metrics.find((m) => m.metric === query.sort.metric)![
        sortKey[query.sort.value]
      ],
      bv = b.metrics.find((m) => m.metric === query.sort.metric)![
        sortKey[query.sort.value]
      ];
    const tie = a.key < b.key ? -1 : a.key === b.key ? 0 : 1;
    if (av === null || bv === null)
      return av === bv ? tie : av === null ? 1 : -1;
    return (
      parseDecimal(av).value.comparedTo(parseDecimal(bv).value) *
        (query.sort.direction === "ASC" ? 1 : -1) || tie
    );
  });
  return {
    query,
    totalGroups: allRows.length,
    evaluatedGroups,
    unknownConditionGroups,
    knownGroups: allRows.filter(
      (r) =>
        r.metrics.some((m) => m.current !== null || m.reference !== null) ||
        r.salesMeasures?.current.quantity.value != null ||
        r.salesMeasures?.reference?.quantity.value != null,
    ).length,
    hasMore: allRows.length > query.offset + query.limit,
    nextOffset:
      allRows.length > query.offset + query.limit
        ? query.offset + query.limit
        : null,
    rows: allRows.slice(query.offset, query.offset + query.limit),
  };
}

/** Shared coverage rule for observed product-days. Callers validate scope/uniqueness first. */
export function aggregateAnalyticsDailyPoints(
  points: readonly AnalyticsQueryPoint[],
  metric: "sales" | "margin" | "waste" | "wasteCost",
  expectedProducts: number,
): DatedKpiValue[] {
  const daily = new Map<string, { values: string[]; complete: number }>();
  for (const p of points) {
    const d = daily.get(p.businessDate) ?? { values: [], complete: 0 };
    const point = p[metric];
    if (point && point.value !== null && point.status !== "UNAVAILABLE") {
      d.values.push(point.value);
      if (point.status === "AVAILABLE") d.complete++;
    }
    daily.set(p.businessDate, d);
  }
  return [...daily].map(([businessDate, d]) => ({
    businessDate,
    value: d.values.length ? addDecimals(d.values) : null,
    status: !d.values.length
      ? "UNAVAILABLE"
      : d.complete === expectedProducts
        ? "AVAILABLE"
        : "PARTIAL",
  }));
}
