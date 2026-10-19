import {
  analyticsExplorerPeriodSchema,
  copilotBusinessDateSchema,
  type AnalyticsExplorerPeriod,
} from "@fl-copilot/domain";
import type { DatePeriod, DatedKpiValue } from "./comparison";
import { compareCustomReference } from "./comparison";
import { sumAvailableCurrency } from "./formulas";
export type ExplorerPeriod = AnalyticsExplorerPeriod;
export const explorerDate = (d: Date) => d.toISOString().slice(0, 10);
export function addExplorerDays(s: string, n: number) {
  const d = new Date(copilotBusinessDateSchema.parse(s) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return explorerDate(d);
}
export function isoWeekOf(s: string) {
  const d = new Date(copilotBusinessDateSchema.parse(s) + "T12:00:00Z"),
    weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() + 3 - weekday);
  const year = d.getUTCFullYear(),
    jan4 = new Date(`${year}-01-04T12:00:00Z`);
  jan4.setUTCDate(jan4.getUTCDate() + 3 - ((jan4.getUTCDay() + 6) % 7));
  return {
    year,
    week: 1 + Math.round((d.getTime() - jan4.getTime()) / 604800000),
    weekday,
  };
}
function weekMonday(year: number, week: number) {
  const jan4 = new Date(`${year}-01-04T12:00:00Z`);
  jan4.setUTCDate(
    jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7,
  );
  const s = explorerDate(jan4),
    actual = isoWeekOf(s);
  if (actual.year !== year || actual.week !== week)
    throw Error("EXPLORER_WEEK_INVALID");
  return s;
}
export function explorerPeriodFromDate(
  kind: ExplorerPeriod["kind"],
  date: string,
): ExplorerPeriod {
  copilotBusinessDateSchema.parse(date);
  const year = Number(date.slice(0, 4));
  return analyticsExplorerPeriodSchema.parse(
    kind === "day"
      ? { kind, date }
      : kind === "week"
        ? { kind, ...(({ year, week }) => ({ year, week }))(isoWeekOf(date)) }
        : kind === "month"
          ? { kind, year, month: Number(date.slice(5, 7)) }
          : { kind, year },
  );
}
export function explorerRange(raw: ExplorerPeriod): DatePeriod {
  const p = analyticsExplorerPeriodSchema.parse(raw);
  if (p.kind === "day") return { start: p.date, end: p.date };
  if (p.kind === "week") {
    const start = weekMonday(p.year, p.week);
    return { start, end: addExplorerDays(start, 6) };
  }
  const start = `${p.year}-${p.kind === "month" ? String(p.month).padStart(2, "0") : "01"}-01`,
    d = new Date(start + "T12:00:00Z");
  if (p.kind === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return { start, end: addExplorerDays(explorerDate(d), -1) };
}
export function shiftExplorerPeriod(
  p: ExplorerPeriod,
  n: number,
): ExplorerPeriod {
  if (!Number.isSafeInteger(n)) throw Error("EXPLORER_SHIFT_INVALID");
  const d = new Date(explorerRange(p).start + "T12:00:00Z");
  if (p.kind === "day" || p.kind === "week")
    d.setUTCDate(d.getUTCDate() + n * (p.kind === "week" ? 7 : 1));
  else if (p.kind === "month") d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  return explorerPeriodFromDate(p.kind, explorerDate(d));
}
export function explorerReference(p: ExplorerPeriod): ExplorerPeriod | null {
  try {
    if (p.kind === "day") {
      const w = isoWeekOf(p.date);
      return {
        kind: "day",
        date: addExplorerDays(weekMonday(w.year - 1, w.week), w.weekday),
      };
    }
    if (p.kind === "week") {
      const ref = { ...p, year: p.year - 1 };
      explorerRange(ref);
      return ref;
    }
    return analyticsExplorerPeriodSchema.parse({ ...p, year: p.year - 1 });
  } catch {
    return null;
  }
}
export function explorerDays(r: DatePeriod) {
  const a: string[] = [];
  for (let s = r.start; s <= r.end; s = addExplorerDays(s, 1)) {
    if (a.length >= 366) throw Error("EXPLORER_PERIOD_TOO_LONG");
    a.push(s);
  }
  return a;
}
export function explorerLabel(p: ExplorerPeriod) {
  const r = explorerRange(p),
    date = new Date(r.start + "T12:00:00Z");
  if (p.kind === "week") return `Semaine ${p.week} · ${p.year}`;
  if (p.kind === "year") return String(p.year);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    ...(p.kind === "month"
      ? { month: "long", year: "numeric" }
      : { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  }).format(date);
}
/** Same metric formula for either runtime. Missing/partial days and a current trading day are never silently counted as full days. */
export function compareExplorerPeriod(input: {
  period: ExplorerPeriod;
  today: string;
  kpiId: string;
  points: readonly DatedKpiValue[];
}) {
  copilotBusinessDateSchema.parse(input.today);
  const range = explorerRange(input.period),
    reference = explorerReference(input.period),
    refRange = reference ? explorerRange(reference) : null,
    currentDates = explorerDays(range),
    refDates = refRange ? explorerDays(refRange) : [],
    map = new Map<string, DatedKpiValue>();
  for (const p of input.points) {
    copilotBusinessDateSchema.parse(p.businessDate);
    if (
      map.has(p.businessDate) ||
      !(
        (p.businessDate >= range.start && p.businessDate <= range.end) ||
        (refRange &&
          p.businessDate >= refRange.start &&
          p.businessDate <= refRange.end)
      )
    )
      throw Error("EXPLORER_POINT_INVALID");
    map.set(p.businessDate, p);
  }
  const point = (date: string): DatedKpiValue =>
    map.get(date) ?? { businessDate: date, value: null, status: "UNAVAILABLE" };
  const current = currentDates.map(point),
    total = sumAvailableCurrency(
      current.map((p) => (p.status === "UNAVAILABLE" ? null : p.value)),
    ),
    coverage = {
      complete: current.filter(
        (p) => p.status === "AVAILABLE" && p.value !== null,
      ).length,
      partial: current.filter((p) => p.status === "PARTIAL" && p.value !== null)
        .length,
      missing: current.filter(
        (p) => p.value === null || p.status === "UNAVAILABLE",
      ).length,
      expected: current.length,
    };
  // For the current civil month/year retain the same elapsed date span, not a made-up weekday-normalised month.
  const pairs = currentDates.flatMap((date, i) => {
    const civil = input.period.kind === "month" || input.period.kind === "year";
    const candidate =
      civil && refRange
        ? `${refRange.start.slice(0, 4)}-${date.slice(5)}`
        : refDates[i];
    const other =
      candidate && copilotBusinessDateSchema.safeParse(candidate).success
        ? candidate
        : undefined;
    return date < input.today && other && other < input.today
      ? [{ current: point(date), reference: point(other) }]
      : [];
  });
  const available = pairs.filter(
    (p) =>
      p.current.status === "AVAILABLE" &&
      p.current.value !== null &&
      p.reference.status === "AVAILABLE" &&
      p.reference.value !== null,
  );
  const eligible = currentDates.filter((d) => d < input.today).length;
  const differentFullCivilPeriod =
    (input.period.kind === "month" || input.period.kind === "year") &&
    range.end < input.today &&
    currentDates.length !== refDates.length;
  const comparable =
    !!reference &&
    pairs.length > 0 &&
    pairs.length === eligible &&
    available.length === pairs.length &&
    !differentFullCivilPeriod;
  const comparison = comparable
    ? compareCustomReference({
        kpiId: input.kpiId,
        currentPoints: available.map((p) => p.current),
        referencePoints: available.map((p) => p.reference),
        aggregation: "SUM",
        referenceMethod:
          input.period.kind === "week" || input.period.kind === "day"
            ? "same ISO week-year N-1, same weekday"
            : "same civil period N-1; same elapsed calendar dates; no weekday normalization",
      })
    : null;
  return {
    range,
    reference,
    referenceRange: refRange,
    total: total.value,
    coverage,
    points: current,
    comparison,
    comparedDays: comparable ? pairs.length : 0,
    comparisonDates: comparable
      ? pairs.map((p) => ({
          current: p.current.businessDate,
          reference: p.reference.businessDate,
        }))
      : [],
    comparisonStatus:
      !reference || differentFullCivilPeriod
        ? ("not_comparable" as const)
        : !pairs.length || !available.length
          ? ("missing_baseline" as const)
          : !comparable
            ? ("partial" as const)
            : ("comparable" as const),
  };
}
/** Chart bins contain only sums of canonical daily amounts. They are never hourly or quantity estimates. */
export function explorerChartBuckets(
  period: ExplorerPeriod,
  points: readonly DatedKpiValue[],
) {
  const range = explorerRange(period);
  return (
    period.kind === "year"
      ? Array.from(
          { length: 12 },
          (_, i) =>
            `${range.start.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`,
        )
      : explorerDays(range)
  ).map((date) => {
    const values =
        period.kind === "year"
          ? points.filter(
              (p) => p.businessDate.slice(0, 7) === date.slice(0, 7),
            )
          : points.filter((p) => p.businessDate === date),
      r =
        period.kind === "year"
          ? explorerRange({
              kind: "month",
              year: period.year,
              month: Number(date.slice(5, 7)),
            })
          : { start: date, end: date },
      expected = explorerDays(r).length,
      total = sumAvailableCurrency(
        values.map((p) => (p.status === "UNAVAILABLE" ? null : p.value)),
      );
    return {
      date,
      value: total.value,
      complete:
        values.length === expected &&
        values.every((p) => p.status === "AVAILABLE" && p.value !== null),
      expected,
    };
  });
}
