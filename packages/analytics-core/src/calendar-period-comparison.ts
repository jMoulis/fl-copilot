import {
  copilotAnalysisPeriodSchema,
  copilotBusinessDateSchema,
} from "@fl-copilot/domain";
import {
  compareCustomReference,
  type DatedKpiValue,
  type DatePeriod,
} from "./comparison";
function calendarDates(period: DatePeriod) {
  const result: string[] = [];
  for (
    let d = Date.parse(`${period.start}T00:00:00Z`),
      end = Date.parse(`${period.end}T00:00:00Z`);
    d <= end;
    d += 86400000
  )
    result.push(new Date(d).toISOString().slice(0, 10));
  return result;
}
function coverage(points: readonly DatedKpiValue[]) {
  return {
    expectedDays: points.length,
    availableDays: points.filter(
      (p) => p.status === "AVAILABLE" && p.value !== null,
    ).length,
    partialDays: points.filter(
      (p) => p.status === "PARTIAL" && p.value !== null,
    ).length,
    missingDays: points.filter(
      (p) => p.value === null || p.status === "UNAVAILABLE",
    ).length,
    missingDateExamples: points
      .filter((p) => p.value === null || p.status === "UNAVAILABLE")
      .slice(0, 14)
      .map((p) => p.businessDate),
  };
}
/** Complete calendar denominator, explicit gaps, exact shared arithmetic. Usable by chat, local charts and exports. */
export function calculateCalendarPeriodComparison(input: {
  kpiId: string;
  currentPeriod: DatePeriod;
  referencePeriod: DatePeriod | null;
  aggregation: "SUM" | "AVERAGE";
  points: readonly DatedKpiValue[];
}) {
  const currentPeriod = copilotAnalysisPeriodSchema.parse(input.currentPeriod);
  const referencePeriod = input.referencePeriod
    ? copilotAnalysisPeriodSchema.parse(input.referencePeriod)
    : null;
  const ranges = [currentPeriod, ...(referencePeriod ? [referencePeriod] : [])];
  const map = new Map<string, DatedKpiValue>();
  for (const p of input.points) {
    copilotBusinessDateSchema.parse(p.businessDate);
    if (
      map.has(p.businessDate) ||
      !ranges.some((r) => p.businessDate >= r.start && p.businessDate <= r.end)
    )
      throw new Error("CALENDAR_PERIOD_POINT_INVALID");
    map.set(p.businessDate, {
      ...p,
      ...(p.value === null || p.status === "UNAVAILABLE"
        ? { value: null, status: "UNAVAILABLE" as const }
        : {}),
    });
  }
  const fill = (period: DatePeriod) =>
    calendarDates(period).map(
      (businessDate) =>
        map.get(businessDate) ?? {
          businessDate,
          value: null,
          status: "UNAVAILABLE" as const,
        },
    );
  const current = fill(currentPeriod),
    reference = referencePeriod ? fill(referencePeriod) : [];
  const currentCoverage = coverage(current),
    referenceCoverage = referencePeriod ? coverage(reference) : null;
  const comparison = compareCustomReference({
    kpiId: input.kpiId,
    currentPoints: current,
    referencePoints: reference,
    aggregation: input.aggregation,
    referenceMethod: "explicit calendar periods supplied by user request",
  });
  // Equal calendar windows with the same weekdays can compare only their
  // jointly recorded dates. Full-period totals remain separate and unchanged.
  const matched =
    referencePeriod &&
    current.length === reference.length &&
    (Date.parse(currentPeriod.start) - Date.parse(referencePeriod.start)) %
      (7 * 86400000) ===
      0
      ? current.flatMap((p, index) => {
          const other = reference[index]!;
          return p.value !== null &&
            p.status !== "UNAVAILABLE" &&
            other.value !== null &&
            other.status !== "UNAVAILABLE"
            ? [{ current: p, reference: other }]
            : [];
        })
      : null;
  const pairedResult = matched
    ? compareCustomReference({
        kpiId: input.kpiId,
        currentPoints: matched.map((p) => p.current),
        referencePoints: matched.map((p) => p.reference),
        aggregation: input.aggregation,
        referenceMethod: "matching recorded weekdays in equal calendar windows",
      })
    : null;
  const matchedComparison =
    pairedResult &&
    matched &&
    matched.length < current.length &&
    pairedResult.status !== "UNAVAILABLE"
      ? {
          ...pairedResult,
          status: "PARTIAL" as const,
          qualityScore: Math.min(
            pairedResult.qualityScore,
            matched.length / current.length,
          ),
          warnings: [
            ...new Set([
              ...pairedResult.warnings,
              ...comparison.warnings.filter(
                (warning) =>
                  warning === "PARTIAL_CURRENT" ||
                  warning === "PARTIAL_REFERENCE",
              ),
            ]),
          ],
        }
      : pairedResult;
  return {
    comparison,
    matchedComparison,
    matchedDays: matched?.length ?? null,
    currentCoverage,
    referenceCoverage,
    complete:
      currentCoverage.availableDays === currentCoverage.expectedDays &&
      !!referenceCoverage &&
      referenceCoverage.availableDays === referenceCoverage.expectedDays,
    warnings: referencePeriod
      ? [
          ...comparison.warnings,
          ...(referenceCoverage &&
          currentCoverage.expectedDays !== referenceCoverage.expectedDays
            ? ["DIFFERENT_PERIOD_LENGTHS"]
            : []),
        ]
      : [],
  };
}
