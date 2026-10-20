import { z } from "zod";
import {
  analyticsExplorerMetricSchema,
  analyticsExplorerFiltersSchema,
  emptyExplorerFilters,
  analyticsExplorerPeriodSchema,
  copilotBusinessDateSchema,
  type AnalyticsExplorerPeriod,
  type AnalyticsExplorerGranularity,
} from "@fl-copilot/domain";
import {
  explorerRange,
  explorerPeriodFromDate,
  shiftExplorerPeriod,
  explorerDays,
  addExplorerDays,
} from "@fl-copilot/analytics-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
const frame = z
  .strictObject({
    period: analyticsExplorerPeriodSchema,
    anchor: copilotBusinessDateSchema,
    filters: analyticsExplorerFiltersSchema.default(emptyExplorerFilters),
    chartScroll: z.number().min(0).max(10000000).default(0),
    detailsOffset: z.number().int().min(0).max(10000).default(0),
    scroll: z.number().min(0).max(10000000),
  })
  .refine((v) => {
    try {
      const r = explorerRange(v.period);
      return v.anchor >= r.start && v.anchor <= r.end;
    } catch {
      return false;
    }
  }, "Invalid period/anchor");
export const explorerViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  metric: analyticsExplorerMetricSchema,
  frame,
  history: z.array(frame).max(16),
});
export type ExplorerView = z.infer<typeof explorerViewSchema>;
export function initialExplorerView(date: string): ExplorerView {
  return explorerViewSchema.parse({
    schemaVersion: 1,
    metric: "sales",
    frame: {
      period: explorerPeriodFromDate("week", date),
      anchor: date,
      filters: emptyExplorerFilters(),
      chartScroll: 0,
      detailsOffset: 0,
      scroll: 0,
    },
    history: [],
  });
}
export function changeExplorerGranularity(
  s: ExplorerView,
  kind: AnalyticsExplorerGranularity,
): ExplorerView {
  return {
    ...s,
    frame: {
      chartScroll: 0,
      detailsOffset: 0,
      filters: s.frame.filters,
      period: explorerPeriodFromDate(kind, s.frame.anchor),
      anchor: s.frame.anchor,
      scroll: 0,
    },
    history: [],
  };
}
export function shiftExplorerView(s: ExplorerView, n: number): ExplorerView {
  if (s.frame.period.kind === "range")
    throw Error("EXPLORER_FIXED_SOURCE_RANGE");
  const period = shiftExplorerPeriod(s.frame.period, n),
    range = explorerRange(period);
  let anchor = range.start;
  if (period.kind === "day" || period.kind === "week") {
    const old = explorerRange(s.frame.period),
      offset = explorerDays(old).indexOf(s.frame.anchor);
    anchor = addExplorerDays(range.start, Math.max(0, offset));
  } else if (period.kind === "month")
    anchor =
      range.start.slice(0, 8) +
      String(
        Math.min(Number(s.frame.anchor.slice(8)), Number(range.end.slice(8))),
      ).padStart(2, "0");
  else if (period.kind === "year") {
    const candidate = `${period.year}-${s.frame.anchor.slice(5)}`;
    anchor = copilotBusinessDateSchema.safeParse(candidate).success
      ? candidate
      : `${period.year}-02-28`;
  } else throw Error("EXPLORER_FIXED_SOURCE_RANGE");
  return {
    ...s,
    frame: {
      period,
      anchor,
      scroll: 0,
      chartScroll: 0,
      detailsOffset: 0,
      filters: s.frame.filters,
    },
    history: [],
  };
}
export function drillExplorerView(s: ExplorerView, date: string): ExplorerView {
  const parent = explorerRange(s.frame.period);
  if (date < parent.start || date > parent.end)
    throw Error("EXPLORER_DRILL_OUTSIDE_PERIOD");
  const kind = s.frame.period.kind === "year" ? "month" : "day";
  let period: AnalyticsExplorerPeriod = explorerPeriodFromDate(kind, date);
  if (s.frame.period.kind === "range") {
    const monthly = explorerDays(parent).length > 62;
    const monthEnd = explorerRange(explorerPeriodFromDate("month", date)).end;
    period = {
      ...s.frame.period,
      current: {
        start: date,
        end:
          monthly && monthEnd < parent.end
            ? monthEnd
            : monthly
              ? parent.end
              : date,
      },
      reference: null,
      aggregation: monthly ? s.frame.period.aggregation : "SUM",
    };
  }
  return explorerViewSchema.parse({
    ...s,
    frame: {
      chartScroll: 0,
      detailsOffset: 0,
      filters: s.frame.filters,
      period,
      anchor: date,
      scroll: 0,
    },
    history: [...s.history, s.frame].slice(-16),
  });
}
export function backExplorerView(s: ExplorerView): ExplorerView {
  return s.history.length
    ? { ...s, frame: s.history.at(-1)!, history: s.history.slice(0, -1) }
    : s;
}
/** Device-local presentation state, scoped to the authenticated user/store. Never enters business sync. */
export class ExplorerViewRepository {
  constructor(
    private db: OutboxDatabase,
    private scope: { storeId: string; ownerId: string; productId?: string },
  ) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.ownerId);
    if (scope.productId !== undefined) z.uuid().parse(scope.productId);
  }
  private get key() {
    return `analytics-view:v1:${this.scope.storeId}:${this.scope.ownerId}${this.scope.productId ? `:product:${this.scope.productId}` : ""}`;
  }
  async read() {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    );
    return row ? this.validate(JSON.parse(row.value)) : null;
  }
  private validate(raw: unknown) {
    const value = explorerViewSchema.parse(raw);
    if (
      this.scope.productId &&
      [value.frame, ...value.history].some(
        (frame) =>
          frame.filters.productId !== this.scope.productId ||
          frame.filters.category !== null ||
          frame.filters.nature !== null ||
          frame.filters.productIds ||
          frame.filters.labelContains,
      )
    )
      throw Error("PRODUCT_PERFORMANCE_SCOPE_INVALID");
    return value;
  }
  async save(value: ExplorerView) {
    const s = this.validate(value);
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      this.key,
      JSON.stringify(s),
      new Date().toISOString(),
    );
  }
}

export function drillExplorerScope(
  s: ExplorerView,
  filters: ExplorerView["frame"]["filters"],
): ExplorerView {
  return explorerViewSchema.parse({
    ...s,
    frame: { ...s.frame, filters, scroll: 0, chartScroll: 0, detailsOffset: 0 },
    history: [...s.history, s.frame].slice(-16),
  });
}
export function drillExplorerWeek(
  s: ExplorerView,
  period: AnalyticsExplorerPeriod,
): ExplorerView {
  const parent = explorerRange(s.frame.period),
    child = explorerRange(period);
  if (
    s.frame.period.kind !== "month" ||
    period.kind !== "week" ||
    child.end < parent.start ||
    child.start > parent.end
  )
    throw Error("EXPLORER_DRILL_OUTSIDE_PERIOD");
  return explorerViewSchema.parse({
    ...s,
    frame: {
      ...s.frame,
      period,
      anchor: child.start < parent.start ? parent.start : child.start,
      scroll: 0,
      chartScroll: 0,
      detailsOffset: 0,
    },
    history: [...s.history, s.frame].slice(-16),
  });
}
