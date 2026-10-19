import { z } from "zod";
import {
  analyticsExplorerPeriodSchema,
  analyticsExplorerMetricSchema,
  analyticsExplorerFiltersSchema,
  emptyExplorerFilters,
  type AnalyticsExplorerMetric,
  type AnalyticsExplorerFilters,
} from "@fl-copilot/domain";
import { explorerRange, type ExplorerPeriod } from "@fl-copilot/analytics-core";
import { explorerViewSchema, type ExplorerView } from "./explorer-state";
const selectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  period: analyticsExplorerPeriodSchema.nullable(),
  metric: analyticsExplorerMetricSchema.nullable(),
  filters: analyticsExplorerFiltersSchema,
});
/** Explicit navigation only: no store, actor, mutation, callback or model-supplied destination. */
export function explorerHref(input: {
  requestId: string;
  period?: ExplorerPeriod;
  metric?: AnalyticsExplorerMetric;
  filters?: AnalyticsExplorerFilters;
}) {
  const selection = selectionSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    period: input.period ?? null,
    metric: input.metric ?? null,
    filters: input.filters ?? emptyExplorerFilters(),
  });
  if (selection.period) explorerRange(selection.period);
  return {
    pathname: "/(tabs)/analytics" as const,
    params: { selection: JSON.stringify(selection) },
  };
}
export function applyExplorerLink(
  view: ExplorerView,
  raw: unknown,
): ExplorerView {
  if (typeof raw !== "string" || raw.length > 4096)
    throw Error("EXPLORER_LINK_INVALID");
  const selection = selectionSchema.parse(JSON.parse(raw));
  const period = selection.period ?? view.frame.period,
    range = explorerRange(period),
    metric = selection.metric ?? view.metric;
  if (
    JSON.stringify([period, metric, selection.filters]) ===
    JSON.stringify([view.frame.period, view.metric, view.frame.filters])
  )
    return view;
  return explorerViewSchema.parse({
    ...view,
    metric,
    frame: {
      period,
      filters: selection.filters,
      anchor: range.start,
      scroll: 0,
      chartScroll: 0,
      detailsOffset: 0,
    },
    history: [...view.history, view.frame].slice(-16),
  });
}
