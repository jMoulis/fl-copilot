import {
  analyticsExplorerFiltersSchema,
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
  explorerReference,
  type ExplorerPeriod,
} from "./explorer-period";
import { sumAvailableCurrency } from "./formulas";
import { parseDecimal } from "./decimal";
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
  return f.category !== null || f.nature !== null || f.productId !== null;
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
}) {
  const filters = analyticsExplorerFiltersSchema.parse(input.filters);
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
    ref = explorerReference(input.period),
    rr = ref ? explorerRange(ref) : null;
  const selected: AnalyticsQueryPoint[] = [],
    seen = new Set<string>();
  const queryFilters = {
    productIds: filters.productId ? [filters.productId] : null,
    category: filters.category,
    nature: filters.nature,
    labelContains: null,
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
    const sum = sumAvailableCurrency(
      current.map((p) =>
        p[input.metric].status === "UNAVAILABLE" ? null : p[input.metric].value,
      ),
    );
    return sum.value === null ? [] : [{ productId, points, amount: sum.value }];
  });
  ranked.sort(
    (a, b) =>
      parseDecimal(b.amount).value.comparedTo(parseDecimal(a.amount).value) ||
      a.productId.localeCompare(b.productId),
  );
  const pageOffset = ranked.length
    ? Math.min(
        offset,
        Math.floor((ranked.length - 1) / EXPLORER_PRODUCT_LIMITS.pageSize) *
          EXPLORER_PRODUCT_LIMITS.pageSize,
      )
    : 0;
  return {
    analysis: analyze(selected, grouped.size),
    selectedProduct: filters.productId
      ? (products.get(filters.productId) ?? null)
      : null,
    observedProductCount: grouped.size,
    categories: [...categories]
      .map(([category, points]) => ({
        category,
        label: categoryLabels[category],
        analysis: analyze(points, new Set(points.map((p) => p.productId)).size),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    contributors: ranked
      .slice(pageOffset, pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize)
      .map((p) => ({
        productId: p.productId,
        label: products.get(p.productId)?.label ?? "Produit à identifier",
        category: products.get(p.productId)?.category ?? "UNKNOWN",
        analysis: analyze(p.points, 1),
      })),
    totalContributors: ranked.length,
    offset: pageOffset,
    nextOffset:
      pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize < ranked.length
        ? pageOffset + EXPLORER_PRODUCT_LIMITS.pageSize
        : null,
  };
}
