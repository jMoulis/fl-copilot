import {
  addContextDays,
  type JournalAssociationStudy,
} from "@fl-copilot/domain";
import { parseDecimal, subtractDecimals } from "./decimal";

export type JournalAssociationPair = {
  date: string;
  calendarMatched: boolean;
  recordedEvent: boolean;
  salesChange: string | null;
  marginChange: string | null;
  temperatureDelta: string | null;
  rainfallDelta: string | null;
};

/** Compare source decimals before converting ranks, preserving exact ties. */
export function spearmanRank(
  xs: readonly string[],
  ys: readonly string[],
): number | null {
  if (xs.length !== ys.length) throw Error("ASSOCIATION_UNPAIRED_SAMPLE");
  const rank = (values: readonly string[]) => {
    const decimals = values.map((v) => parseDecimal(v).value);
    const order = decimals
      .map((_, i) => i)
      .sort((a, b) => decimals[a]!.comparedTo(decimals[b]!));
    const result = Array<number>(values.length);
    for (let start = 0; start < order.length;) {
      let end = start + 1;
      while (
        end < order.length &&
        decimals[order[start]!]!.eq(decimals[order[end]!]!)
      )
        end++;
      for (let j = start; j < end; j++)
        result[order[j]!] = (start + 1 + end) / 2;
      start = end;
    }
    return result;
  };
  const x = rank(xs),
    y = rank(ys),
    n = xs.length;
  if (n < 3) return null;
  const mean = (n + 1) / 2;
  let xx = 0,
    yy = 0,
    xy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i]! - mean,
      b = y[i]! - mean;
    xx += a * a;
    yy += b * b;
    xy += a * b;
  }
  return xx === 0 || yy === 0
    ? null
    : Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)));
}

export const weatherDifference = (
  a: string | null | undefined,
  b: string | null | undefined,
) => (a == null || b == null ? null : subtractDecimals(a, b));

/** Monday date includes ISO year: adjacent Dec/Jan days never form two weeks. */
const week = (date: string) =>
  addContextDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

export function describeJournalAssociations(
  pairs: readonly JournalAssociationPair[],
): JournalAssociationStudy["series"] {
  if (
    pairs.length > 93 ||
    new Set(pairs.map((p) => p.date)).size !== pairs.length
  )
    throw Error("ASSOCIATION_SAMPLE_INVALID");
  const results: JournalAssociationStudy["series"] = [];
  for (const metric of ["sales", "margin"] as const) {
    for (const exposure of [
      "TEMPERATURE_MAX_DELTA_C",
      "RAINFALL_DELTA_MM",
    ] as const) {
      const excluded = { calendar: 0, business: 0, weather: 0 };
      const rows: {
        date: string;
        x: string;
        y: string;
        recordedEvent: boolean;
      }[] = [];
      for (const p of pairs) {
        const y = metric === "sales" ? p.salesChange : p.marginChange;
        const x =
          exposure === "TEMPERATURE_MAX_DELTA_C"
            ? p.temperatureDelta
            : p.rainfallDelta;
        // Counts are disjoint: first missing qualification wins.
        if (!p.calendarMatched) excluded.calendar++;
        else if (y === null) excluded.business++;
        else if (x === null) excluded.weather++;
        else rows.push({ date: p.date, x, y, recordedEvent: p.recordedEvent });
      }
      const calc = (r: typeof rows) =>
        spearmanRank(
          r.map((p) => p.x),
          r.map((p) => p.y),
        );
      const rho = calc(rows),
        weeks = [...new Set(rows.map((p) => week(p.date)))];
      const sufficient = rows.length >= 21 && weeks.length >= 4;
      const coefficients = sufficient
        ? weeks.map((w) => calc(rows.filter((p) => week(p.date) !== w)))
        : [];
      const defined = coefficients.filter((v): v is number => v !== null);
      const sameDirection =
        !sufficient || rho === null
          ? null
          : rho !== 0 &&
            defined.length === coefficients.length &&
            defined.every((v) => v * rho > 0);
      const without = rows.filter((p) => !p.recordedEvent);
      results.push({
        metric,
        exposure,
        status: !sufficient
          ? "INSUFFICIENT_DATA"
          : rho === null
            ? "UNDEFINED"
            : sameDirection
              ? "ASSOCIATION_OBSERVED"
              : "FRAGILE",
        pairs: rows.length,
        weeks: weeks.length,
        rho,
        excluded,
        leaveOneWeekOut: {
          evaluatedWeeks: coefficients.length,
          min: defined.length ? Math.min(...defined) : null,
          max: defined.length ? Math.max(...defined) : null,
          sameDirection,
        },
        withoutRecordedEvents: { pairs: without.length, rho: calc(without) },
      });
    }
  }
  return results;
}
