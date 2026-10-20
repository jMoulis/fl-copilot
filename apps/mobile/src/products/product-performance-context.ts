import { z } from "zod";
import type { AnalyticsExplorerMetric } from "@fl-copilot/domain";
import { emptyExplorerFilters } from "@fl-copilot/domain";
import { explorerHref, applyExplorerLink } from "../analytics/explorer-link";
import {
  initialExplorerView,
  explorerViewSchema,
  type ExplorerView,
} from "../analytics/explorer-state";
/** A product detail always uses the same period/comparison contract as the Explorer. */
export function productPerformanceView(
  productId: string,
  date: string,
  context?: ExplorerView,
): ExplorerView {
  z.uuid().parse(productId);
  const base = context
    ? explorerViewSchema.parse(context)
    : initialExplorerView(date);
  return explorerViewSchema.parse({
    ...base,
    frame: {
      ...base.frame,
      filters: { ...emptyExplorerFilters(), productId },
      scroll: 0,
      chartScroll: 0,
      detailsOffset: 0,
    },
    history: [],
  });
}
export function applyProductPerformanceLink(
  productId: string,
  view: ExplorerView,
  raw: unknown,
) {
  const next = applyExplorerLink(view, raw);
  if (
    next.frame.filters.productId !== productId ||
    next.frame.filters.category !== null ||
    next.frame.filters.nature !== null ||
    next.frame.filters.productIds ||
    next.frame.filters.labelContains
  )
    throw Error("PRODUCT_PERFORMANCE_LINK_INVALID");
  return productPerformanceView(productId, next.frame.anchor, next);
}
export function productDetailHref(
  productId: string,
  requestId: string,
  view: ExplorerView,
) {
  const scoped = productPerformanceView(productId, view.frame.anchor, view);
  return {
    pathname: "/(tabs)/products/[id]" as const,
    params: {
      id: productId,
      selection: explorerHref({
        requestId,
        period: scoped.frame.period,
        metric: scoped.metric,
        filters: scoped.frame.filters,
      }).params.selection,
    },
  };
}
export function productPerformanceHref(
  productId: string,
  requestId: string,
  view: ExplorerView,
  metric?: AnalyticsExplorerMetric,
) {
  const scoped = productPerformanceView(productId, view.frame.anchor, view);
  return explorerHref({
    requestId,
    period: scoped.frame.period,
    metric: metric ?? scoped.metric,
    filters: scoped.frame.filters,
  });
}
