import { z } from "zod";
import {
  analyticsExplorerMetricSchema,
  analyticsExplorerPeriodSchema,
  copilotBusinessDateSchema,
  type AnalyticsExplorerPeriod,
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
      scroll: 0,
    },
    history: [],
  });
}
export function changeExplorerGranularity(
  s: ExplorerView,
  kind: AnalyticsExplorerPeriod["kind"],
): ExplorerView {
  return {
    ...s,
    frame: {
      period: explorerPeriodFromDate(kind, s.frame.anchor),
      anchor: s.frame.anchor,
      scroll: 0,
    },
    history: [],
  };
}
export function shiftExplorerView(s: ExplorerView, n: number): ExplorerView {
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
  else {
    const candidate = `${period.year}-${s.frame.anchor.slice(5)}`;
    anchor = copilotBusinessDateSchema.safeParse(candidate).success
      ? candidate
      : `${period.year}-02-28`;
  }
  return {
    ...s,
    frame: { period, anchor, scroll: 0 },
    history: [],
  };
}
export function drillExplorerView(s: ExplorerView, date: string): ExplorerView {
  const parent = explorerRange(s.frame.period);
  if (date < parent.start || date > parent.end)
    throw Error("EXPLORER_DRILL_OUTSIDE_PERIOD");
  const kind = s.frame.period.kind === "year" ? "month" : "day";
  return explorerViewSchema.parse({
    ...s,
    frame: {
      period: explorerPeriodFromDate(kind, date),
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
    private scope: { storeId: string; ownerId: string },
  ) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.ownerId);
  }
  private get key() {
    return `analytics-view:v1:${this.scope.storeId}:${this.scope.ownerId}`;
  }
  async read() {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    );
    return row ? explorerViewSchema.parse(JSON.parse(row.value)) : null;
  }
  async save(value: ExplorerView) {
    const s = explorerViewSchema.parse(value);
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      this.key,
      JSON.stringify(s),
      new Date().toISOString(),
    );
  }
}
