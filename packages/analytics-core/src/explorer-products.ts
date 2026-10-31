import {
  analyticsExplorerFiltersSchema,
  analyticsProductListSchema,
  defaultAnalyticsProductList,
  type AnalyticsProductList,
  type AnalyticsExplorerFilters,
  type AnalyticsExplorerMetric,
} from "@fl-copilot/domain";
import {
  aggregateAnalyticsDailyPoints,
  analyticsProductMatches,
  analyticsQueryProductSchema,
  type AnalyticsQueryPoint,
  type AnalyticsQueryProduct,
} from "./analytics-query";
import {
  compareExplorerPeriod,
  explorerRange,
  explorerReferenceRange,
  type ExplorerPeriod,
} from "./explorer-period";
import { sumAvailableCurrency } from "./formulas";
import { parseDecimal } from "./decimal";
import { averageDecimals } from "./comparison";
export const EXPLORER_PRODUCT_LIMITS = {
  products: 10000,
  points: 500000,
  pageSize: 20,
} as const;
const categoryLabels = {
  FRUIT: "Fruits",
  VEGETABLE: "Légumes",
  OTHER: "Autres",
  UNKNOWN: "Catégorie à préciser",
} as const;
export function explorerHasFilters(f: AnalyticsExplorerFilters) {
  return (
    f.category !== null ||
    f.nature !== null ||
    f.productId !== null ||
    !!f.productIds ||
    !!f.labelContains
  );
}
/** Same observed-product coverage as analytics.query, followed by the qualified Explorer calendar policy. */
export function analyzeExplorerProducts(input: {
  storeId: string;
  period: ExplorerPeriod;
  metric: AnalyticsExplorerMetric;
  today: string;
  filters: AnalyticsExplorerFilters;
  products: readonly AnalyticsQueryProduct[];
  points: readonly AnalyticsQueryPoint[];
  offset?: number;
  productList?: AnalyticsProductList;
  expectedProductIds?: readonly string[];
}) {
  const filters = analyticsExplorerFiltersSchema.parse(input.filters);
  const list = analyticsProductListSchema.parse(
    input.productList ?? defaultAnalyticsProductList(),
  );
  if (
    input.products.length > EXPLORER_PRODUCT_LIMITS.products ||
    input.points.length > EXPLORER_PRODUCT_LIMITS.points
  )
    throw Error("EXPLORER_DETAILS_LIMIT");
  const offset = input.offset ?? 0;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > EXPLORER_PRODUCT_LIMITS.products
  )
    throw Error("EXPLORER_OFFSET_INVALID");
  const products = new Map<string, AnalyticsQueryProduct>();
  for (const raw of input.products) {
    const p = analyticsQueryProductSchema.parse(raw);
    if (products.has(p.id)) throw Error("EXPLORER_PRODUCT_DUPLICATE");
    products.set(p.id, p);
  }
  const range = explorerRange(input.period),
    rr = explorerReferenceRange(input.period);
  const selected: AnalyticsQueryPoint[] = [],
    seen = new Set<string>();
  const queryFilters = {
    productIds: filters.productId
      ? [filters.productId]
      : (filters.productIds ?? null),
    category: filters.category,
    nature: filters.nature,
    labelContains: filters.labelContains ?? null,
  };
  for (const p of input.points) {
    const key = `${p.productId}/${p.businessDate}`;
    if (
      p.storeId !== input.storeId ||
      seen.has(key) ||
      !(
        (p.businessDate >= range.start && p.businessDate <= range.end) ||
        (rr && p.businessDate >= rr.start && p.businessDate <= rr.end)
      )
    )
      throw Error("EXPLORER_PRODUCT_SCOPE");
    seen.add(key);
    const product = products.get(p.productId);
    if (filters.productIds && !filters.productIds.includes(p.productId))
      continue;
    if (
      explorerHasFilters(filters) &&
      (!product || !analyticsProductMatches(product, queryFilters))
    )
      continue;
    selected.push(p);
  }
  const grouped = new Map<string, AnalyticsQueryPoint[]>();
  const categories = new Map<
    keyof typeof categoryLabels,
    AnalyticsQueryPoint[]
  >();
  for (const p of selected) {
    const group = grouped.get(p.productId) ?? [];
    group.push(p);
    grouped.set(p.productId, group);
    const category = products.get(p.productId)?.category ?? "UNKNOWN";
    const cg = categories.get(category) ?? [];
    cg.push(p);
    categories.set(category, cg);
  }
  const expected = input.expectedProductIds
    ? new Set(input.expectedProductIds)
    : new Set(grouped.keys());
  if (
    expected.size !== (input.expectedProductIds?.length ?? expected.size) ||
    expected.size > EXPLORER_PRODUCT_LIMITS.products
  )
    throw Error("EXPLORER_PRODUCT_SCOPE");
  for (const id of grouped.keys())
    if (!expected.has(id)) throw Error("EXPLORER_PRODUCT_SCOPE");
  for (const id of expected) {
    const category = products.get(id)?.category ?? "UNKNOWN";
    if (!categories.has(category)) categories.set(category, []);
  }
  const analyze = (points: readonly AnalyticsQueryPoint[], count: number) =>
    compareExplorerPeriod({
      period: input.period,
      today: input.today,
      kpiId: input.metric,
      points: aggregateAnalyticsDailyPoints(points, input.metric, count),
    });
  const ranked = [...grouped].flatMap(([productId, points]) => {
    const current = points.filter(
      (p) => p.businessDate >= range.start && p.businessDate <= range.end,
    );
    const values = current.flatMap((p) => {
      const { status, value } = p[input.metric] ?? {
        value: null,
        status: "UNAVAILABLE",
      };
      return status === "UNAVAILABLE" || value === null ? [] : [value];
    });
    const amount =
      input.period.kind === "range" && input.period.aggregation === "AVERAGE"
        ? values.length
          ? averageDecimals(values)
          : null
        : sumAvailableCurrency(values).value;
    return amount === null ? [] : [{ productId, points, amount }];
  });
  // Compute per-product comparisons only when the requested list needs them.
  // Keep the default amount ranking cheap and never sort just the visible page.
  const analyses = new Map<string, ReturnType<typeof analyze>>();
  const needsComparison = list.trend !== "ALL" || list.sort !== "AMOUNT";
  if (needsComparison)
    for (const p of ranked) analyses.set(p.productId, analyze(p.points, 1));
  const difference = (id: string) =>
    analyses.get(id)?.comparison?.absoluteDifference ?? null;
  const filtered = ranked.filter((p) => {
    if (list.trend === "ALL") return true;
    const value = difference(p.productId);
    if (list.trend === "UNAVAILABLE") return value === null;
    if (value === null) return false;
    const sign = parseDecimal(value).value.comparedTo(0);
    return list.trend === "DOWN" ? sign < 0 : sign > 0;
  });
  const sortValue = (p: (typeof ranked)[number]) =>
    list.sort === "AMOUNT"
      ? p.amount
      : list.sort === "DIFFERENCE"
        ? difference(p.productId)
        : (analyses.get(p.productId)?.comparison?.percentageDifference ?? null);
  filtered.sort((a, b) => {
    const av = sortValue(a),
      bv = sortValue(b);
    if (av === null || bv === null)
      return av === bv
        ? a.productId.localeCompare(b.productId)
        : av === null
          ? 1
          : -1;
    const order = parseDecimal(av).value.comparedTo(parseDecimal(bv).value);
    return (
      (list.direction === "ASC" ? order : -order) ||
      a.productId.localeCompare(b.productId)
    );
  });
  const pageOffset = filtered.length
    ? Math.min(
        offset,
        Math.floor((filtered.length - 1) / EXPLORER_PRODUCT_LIMITS.pageSize) *
          EXPLORER_PRODUCT_LIMITS.pageSize,
      )
    : 0;
  return {
    analysis: analyze(selected, expected.size),
    selectedProduct: filters.productId
      ? (products.get(filters.productId) ?? null)
      : null,
    observedProductCount: expected.size,
    categories: [...categories]
      .map(([category, points]) => ({
        category,
        label: categoryLabels[category],
        analysis: analyze(
          points,
          [...expected].filter(
            (id) => (products.get(id)?.category ?? "UNKNOWN") === category,
          ).length,
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    contributors: filtered
      .slice(pageOffset, pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize)
      .map((p) => ({
        productId: p.productId,
        label: products.get(p.productId)?.label ?? "Produit à identifier",
        category: products.get(p.productId)?.category ?? "UNKNOWN",
        analysis: analyses.get(p.productId) ?? analyze(p.points, 1),
      })),
    totalContributors: filtered.length,
    offset: pageOffset,
    nextOffset:
      pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize < filtered.length
        ? pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize
        : null,
  };
}
