import {
  analyticsExplorerPeriodSchema,
  copilotBusinessDateSchema,
  type AnalyticsExplorerPeriod,
  type AnalyticsExplorerGranularity,
} from "@fl-copilot/domain";
import type { DatePeriod, DatedKpiValue } from "./comparison";
import {
  compareCustomReference,
  previousIsoYearDate,
  type ComparisonResult,
} from "./comparison";
import { calculateCalendarPeriodComparison } from "./calendar-period-comparison";
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
  kind: AnalyticsExplorerGranularity,
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
  if (p.kind === "range") return p.current;
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
  if (p.kind === "range") throw Error("EXPLORER_FIXED_SOURCE_RANGE");
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
    if (p.kind === "range")
      return p.reference
        ? { ...p, current: p.reference, reference: null }
        : null;
    if (p.kind === "day") {
      const date = previousIsoYearDate(p.date);
      return date ? { kind: "day", date } : null;
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
/** The reference of a civil month/year may extend outside its civil anniversary. */
export function explorerReferenceRange(p: ExplorerPeriod): DatePeriod | null {
  if (p.kind === "range") return p.reference;
  const dates = explorerDays(explorerRange(p))
    .flatMap((date) => {
      const reference = previousIsoYearDate(date);
      return reference ? [reference] : [];
    })
    .sort();
  return dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
}
export function explorerDays(r: DatePeriod) {
  const a: string[] = [];
  for (let s = r.start; s <= r.end; s = addExplorerDays(s, 1)) {
    if (a.length >= 3660) throw Error("EXPLORER_PERIOD_TOO_LONG");
    a.push(s);
  }
  return a;
}
export function explorerLabel(p: ExplorerPeriod) {
  const r = explorerRange(p),
    date = new Date(r.start + "T12:00:00Z");
  if (p.kind === "range") return "Période de la discussion";
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
  if (input.period.kind === "range")
    return compareExplicitExplorerPeriod(
      input as typeof input & {
        period: Extract<ExplorerPeriod, { kind: "range" }>;
      },
    );
  const range = explorerRange(input.period),
    reference = explorerReference(input.period),
    refRange = explorerReferenceRange(input.period),
    currentDates = explorerDays(range),
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
  const pairs = currentDates.flatMap((date) => {
    const other = previousIsoYearDate(date);
    return date < input.today && other && other < input.today
      ? [{ current: point(date), reference: point(other) }]
      : [];
  });
  const available = pairs.filter(
    (p) =>
      p.current.status !== "UNAVAILABLE" &&
      p.current.value !== null &&
      p.reference.status !== "UNAVAILABLE" &&
      p.reference.value !== null,
  );
  const eligible = currentDates.filter((d) => d < input.today).length;
  const comparable =
    !!reference &&
    pairs.length > 0 &&
    pairs.length === eligible &&
    available.length === pairs.length &&
    available.every(
      (p) =>
        p.current.status === "AVAILABLE" && p.reference.status === "AVAILABLE",
    );
  const rawComparison = available.length
    ? compareCustomReference({
        kpiId: input.kpiId,
        currentPoints: available.map((p) => p.current),
        referencePoints: available.map((p) => p.reference),
        aggregation: "SUM",
        referenceMethod:
          "same ISO week-year N-1, same weekday; paired recorded closed days",
      })
    : null;
  const comparison: ComparisonResult | null =
    rawComparison && !comparable
      ? {
          ...rawComparison,
          status: "PARTIAL",
          qualityScore: Math.min(
            rawComparison.qualityScore,
            available.length / eligible,
          ),
          warnings: [
            ...new Set([
              ...rawComparison.warnings,
              "PARTIAL_CURRENT" as const,
              "PARTIAL_REFERENCE" as const,
            ]),
          ],
        }
      : rawComparison;
  return {
    mode: "DEFAULT" as const,
    sourceBasis: null,
    warnings:
      pairs.length < eligible ? ["NO_ISO_EQUIVALENT"] : ([] as string[]),
    range,
    reference,
    referenceRange: refRange,
    total: total.value,
    coverage,
    points: current,
    comparison,
    comparedDays: available.length,
    comparisonDates: available.map((p) => ({
      current: p.current.businessDate,
      reference: p.reference.businessDate,
    })),
    comparisonStatus:
      !reference || !refRange
        ? ("not_comparable" as const)
        : !available.length
          ? ("missing_baseline" as const)
          : !comparable
            ? ("partial" as const)
            : ("comparable" as const),
  };
}
/** Daily amounts, or monthly aggregates for broad ranges, from the same canonical points. */
export function explorerChartBuckets(
  period: ExplorerPeriod,
  points: readonly DatedKpiValue[],
) {
  const range = explorerRange(period),
    monthly =
      period.kind === "year" ||
      (period.kind === "range" && explorerDays(range).length > 62);
  const dates: string[] = [];
  if (monthly) {
    for (let date = range.start; date <= range.end;) {
      dates.push(date);
      const d = new Date(date + "T12:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      date = explorerDate(d);
    }
  } else dates.push(...explorerDays(range));
  return dates.map((date) => {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    const end = monthly
      ? [addExplorerDays(explorerDate(d), -1), range.end].sort()[0]
      : date;
    const r = { start: date, end },
      values = points.filter(
        (p) => p.businessDate >= date && p.businessDate <= end,
      );
    const expected = explorerDays(r).length;
    const sum = sumAvailableCurrency(
      values.map((p) => (p.status === "UNAVAILABLE" ? null : p.value)),
    );
    const value =
      period.kind === "range" && period.aggregation === "AVERAGE"
        ? calculateCalendarPeriodComparison({
            kpiId: "chart",
            currentPeriod: r,
            referencePeriod: null,
            aggregation: "AVERAGE",
            points: values,
          }).comparison.currentValue
        : sum.value;
    return {
      date,
      end,
      value,
      complete:
        values.length === expected &&
        values.every((p) => p.status === "AVAILABLE" && p.value !== null),
      expected,
      monthly,
    };
  });
}
function compareExplicitExplorerPeriod(input: {
  period: Extract<ExplorerPeriod, { kind: "range" }>;
  today: string;
  kpiId: string;
  points: readonly DatedKpiValue[];
}) {
  const p = input.period,
    result = calculateCalendarPeriodComparison({
      kpiId: input.kpiId,
      currentPeriod: p.current,
      referencePeriod: p.reference,
      aggregation: p.aggregation,
      points: input.points,
    });
  const dates = explorerDays(p.current),
    map = new Map(input.points.map((p) => [p.businessDate, p]));
  const closed =
    p.current.end < input.today &&
    (!p.reference || p.reference.end < input.today);
  const equalLength =
    !!p.reference && dates.length === explorerDays(p.reference).length;
  const comparable =
    result.complete && closed && (equalLength || p.aggregation === "AVERAGE");
  return {
    mode: "EXPLICIT" as const,
    sourceBasis: p.basis,
    warnings: [
      ...result.warnings,
      ...(!closed ? ["OPEN_OR_FUTURE_PERIOD"] : []),
    ],
    range: p.current,
    reference: explorerReference(p),
    referenceRange: p.reference,
    total: result.comparison.currentValue,
    coverage: {
      complete: result.currentCoverage.availableDays,
      partial: result.currentCoverage.partialDays,
      missing: result.currentCoverage.missingDays,
      expected: result.currentCoverage.expectedDays,
    },
    points: dates.map(
      (businessDate) =>
        map.get(businessDate) ?? {
          businessDate,
          value: null,
          status: "UNAVAILABLE" as const,
        },
    ),
    comparison: comparable ? result.comparison : null,
    comparedDays: comparable ? dates.length : 0,
    comparisonDates: [] as { current: string; reference: string }[],
    comparisonStatus: comparable
      ? ("comparable" as const)
      : !p.reference
        ? ("missing_baseline" as const)
        : !equalLength && p.aggregation === "SUM"
          ? ("not_comparable" as const)
          : ("partial" as const),
  };
}
export function explorerMonthWeeks(period: ExplorerPeriod) {
  if (period.kind !== "month") return [];
  const range = explorerRange(period),
    result: ExplorerPeriod[] = [];
  for (let date = range.start; date <= range.end;) {
    const week = explorerPeriodFromDate("week", date);
    result.push(week);
    date = addExplorerDays(explorerRange(week).end, 1);
  }
  return result;
}
