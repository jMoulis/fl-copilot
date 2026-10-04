import {
  BusinessDecimal,
  addDecimals,
  parseDecimal,
  serializeDecimal,
  subtractDecimals,
  type DecimalString,
} from "./decimal";
import type { FormulaStatus } from "./formulas";

export type ComparisonMode =
  | "J_MINUS_7"
  | "PREVIOUS_COMPARABLE_WEEK"
  | "AVERAGE_PREVIOUS_SAME_WEEKDAY"
  | "YEAR_OVER_YEAR"
  | "BEFORE_OPERATION"
  | "CUSTOM_REFERENCE";

export type ComparisonWarning =
  | "MISSING_CURRENT"
  | "MISSING_REFERENCE"
  | "PARTIAL_CURRENT"
  | "PARTIAL_REFERENCE"
  | "ZERO_REFERENCE"
  | "SAMPLE_SIZE_MISMATCH";

export interface DatedKpiValue {
  readonly businessDate: string;
  readonly value: string | null;
  readonly status: FormulaStatus;
  readonly sourceLineageIds?: readonly string[];
}

export interface ComparisonResult {
  readonly kpiId: string;
  readonly currentValue: DecimalString | null;
  readonly referenceValue: DecimalString | null;
  readonly absoluteDifference: DecimalString | null;
  readonly percentageDifference: DecimalString | null;
  readonly referenceMode: ComparisonMode;
  readonly referenceMethod: string;
  readonly currentPeriod: DatePeriod | null;
  readonly referencePeriod: DatePeriod | null;
  readonly currentSampleSize: number;
  readonly referenceSampleSize: number;
  readonly status: FormulaStatus;
  readonly qualityScore: number;
  readonly warnings: readonly ComparisonWarning[];
  readonly sourceLineageIds: readonly string[];
}

export interface DatePeriod {
  readonly start: string;
  readonly end: string;
}

interface ComparisonRequest {
  readonly kpiId: string;
  readonly mode: ComparisonMode;
  readonly method: string;
  readonly currentPoints: readonly DatedKpiValue[];
  readonly referencePoints: readonly DatedKpiValue[];
  readonly currentAggregation: "SUM" | "AVERAGE";
  readonly referenceAggregation: "SUM" | "AVERAGE";
  readonly expectedCurrentSampleSize: number;
  readonly expectedReferenceSampleSize: number;
  readonly requireEqualPeriodSizes?: boolean;
}

export function compareJMinus7(input: {
  readonly kpiId: string;
  readonly current: DatedKpiValue;
  readonly history: readonly DatedKpiValue[];
}): ComparisonResult {
  validatePoint(input.current);
  const history = historyByDate(input.history);
  const referenceDate = addUtcDays(input.current.businessDate, -7);
  const reference = history.get(referenceDate);
  return compareSamples({
    kpiId: input.kpiId,
    mode: "J_MINUS_7",
    method: `same weekday 7 days earlier (${referenceDate})`,
    currentPoints: [input.current],
    referencePoints: reference ? [reference] : [],
    currentAggregation: "SUM",
    referenceAggregation: "SUM",
    expectedCurrentSampleSize: 1,
    expectedReferenceSampleSize: 1,
  });
}

export function compareAveragePreviousSameWeekday(input: {
  readonly kpiId: string;
  readonly current: DatedKpiValue;
  readonly history: readonly DatedKpiValue[];
  readonly targetSampleSize?: number;
}): ComparisonResult {
  validatePoint(input.current);
  const targetSampleSize = input.targetSampleSize ?? 4;
  if (!Number.isSafeInteger(targetSampleSize) || targetSampleSize <= 0) {
    throw new Error("targetSampleSize must be a positive integer.");
  }
  const currentWeekday = weekday(input.current.businessDate);
  const references = uniquePoints(input.history)
    .filter(
      (point) =>
        point.businessDate < input.current.businessDate &&
        weekday(point.businessDate) === currentWeekday,
    )
    .sort((left, right) => right.businessDate.localeCompare(left.businessDate))
    .slice(0, targetSampleSize);
  const availableCount = references.filter(isAvailablePoint).length;

  return compareSamples({
    kpiId: input.kpiId,
    mode: "AVERAGE_PREVIOUS_SAME_WEEKDAY",
    method: `average of ${availableCount} available previous same weekdays (target ${targetSampleSize})`,
    currentPoints: [input.current],
    referencePoints: references,
    currentAggregation: "SUM",
    referenceAggregation: "AVERAGE",
    expectedCurrentSampleSize: 1,
    expectedReferenceSampleSize: targetSampleSize,
  });
}

export function compareYearOverYear(input: {
  readonly kpiId: string;
  readonly current: DatedKpiValue;
  readonly history: readonly DatedKpiValue[];
}): ComparisonResult {
  validatePoint(input.current);
  const referenceDate = previousYearDate(input.current.businessDate);
  const reference = referenceDate
    ? historyByDate(input.history).get(referenceDate)
    : undefined;
  return compareSamples({
    kpiId: input.kpiId,
    mode: "YEAR_OVER_YEAR",
    method: referenceDate
      ? `same calendar date in previous year (${referenceDate})`
      : "same calendar date in previous year unavailable for leap day",
    currentPoints: [input.current],
    referencePoints: reference ? [reference] : [],
    currentAggregation: "SUM",
    referenceAggregation: "SUM",
    expectedCurrentSampleSize: 1,
    expectedReferenceSampleSize: 1,
  });
}

export function comparePreviousComparableWeek(input: {
  readonly kpiId: string;
  readonly currentPeriod: readonly DatedKpiValue[];
  readonly previousPeriod: readonly DatedKpiValue[];
}): ComparisonResult {
  const currentPeriod = uniquePoints(input.currentPeriod);
  const previousByDate = historyByDate(input.previousPeriod);
  const comparablePreviousPeriod = currentPeriod.flatMap((point) => {
    const reference = previousByDate.get(addUtcDays(point.businessDate, -7));
    return reference ? [reference] : [];
  });
  return compareSamples({
    kpiId: input.kpiId,
    mode: "PREVIOUS_COMPARABLE_WEEK",
    method: "sum of equivalent business days in previous comparable week",
    currentPoints: currentPeriod,
    referencePoints: comparablePreviousPeriod,
    currentAggregation: "SUM",
    referenceAggregation: "SUM",
    expectedCurrentSampleSize: currentPeriod.length,
    expectedReferenceSampleSize: currentPeriod.length,
    requireEqualPeriodSizes: true,
  });
}

export function compareBeforeOperation(input: {
  readonly kpiId: string;
  readonly operationPeriod: readonly DatedKpiValue[];
  readonly baselinePeriod: readonly DatedKpiValue[];
  readonly referenceMethod: string;
}): ComparisonResult {
  if (input.referenceMethod.trim().length === 0) {
    throw new Error(
      "referenceMethod must describe the before-operation baseline.",
    );
  }
  return compareSamples({
    kpiId: input.kpiId,
    mode: "BEFORE_OPERATION",
    method: input.referenceMethod.trim(),
    currentPoints: uniquePoints(input.operationPeriod),
    referencePoints: uniquePoints(input.baselinePeriod),
    currentAggregation: "SUM",
    referenceAggregation: "SUM",
    expectedCurrentSampleSize: input.operationPeriod.length,
    expectedReferenceSampleSize: input.operationPeriod.length,
    requireEqualPeriodSizes: true,
  });
}

export function compareCustomReference(input: {
  readonly kpiId: string;
  readonly currentPoints: readonly DatedKpiValue[];
  readonly referencePoints: readonly DatedKpiValue[];
  readonly referenceMethod: string;
  readonly aggregation?: "SUM" | "AVERAGE";
  readonly expectedReferenceSampleSize?: number;
}): ComparisonResult {
  if (input.referenceMethod.trim().length === 0) {
    throw new Error("referenceMethod must describe the custom reference.");
  }
  const aggregation = input.aggregation ?? "SUM";
  return compareSamples({
    kpiId: input.kpiId,
    mode: "CUSTOM_REFERENCE",
    method: input.referenceMethod.trim(),
    currentPoints: uniquePoints(input.currentPoints),
    referencePoints: uniquePoints(input.referencePoints),
    currentAggregation: aggregation,
    referenceAggregation: aggregation,
    expectedCurrentSampleSize: input.currentPoints.length,
    expectedReferenceSampleSize:
      input.expectedReferenceSampleSize ?? input.referencePoints.length,
  });
}

export function serializeComparisonResult(result: ComparisonResult): string {
  return JSON.stringify(result);
}

function compareSamples(request: ComparisonRequest): ComparisonResult {
  const current = aggregateSample(
    request.currentPoints,
    request.currentAggregation,
    request.expectedCurrentSampleSize,
  );
  const reference = aggregateSample(
    request.referencePoints,
    request.referenceAggregation,
    request.expectedReferenceSampleSize,
  );
  const warnings = new Set<ComparisonWarning>();

  if (current.value === null) warnings.add("MISSING_CURRENT");
  else if (current.status === "PARTIAL") warnings.add("PARTIAL_CURRENT");
  if (reference.value === null) warnings.add("MISSING_REFERENCE");
  else if (reference.status === "PARTIAL") warnings.add("PARTIAL_REFERENCE");

  const periodSizeMismatch =
    request.requireEqualPeriodSizes === true &&
    request.currentPoints.length !== request.referencePoints.length;
  if (periodSizeMismatch) warnings.add("SAMPLE_SIZE_MISMATCH");

  let absoluteDifference: DecimalString | null = null;
  let percentageDifference: DecimalString | null = null;
  if (
    current.value !== null &&
    reference.value !== null &&
    !periodSizeMismatch
  ) {
    absoluteDifference = subtractDecimals(current.value, reference.value);
    const referenceDecimal = parseDecimal(reference.value).value;
    if (referenceDecimal.isZero()) {
      warnings.add("ZERO_REFERENCE");
    } else {
      percentageDifference = serializeDecimal(
        parseDecimal(absoluteDifference)
          .value.dividedBy(referenceDecimal.abs())
          .times(100),
        2,
      );
    }
  }

  const status = comparisonStatus(current, reference, periodSizeMismatch);
  return {
    kpiId: request.kpiId,
    currentValue: current.value,
    referenceValue: reference.value,
    absoluteDifference,
    percentageDifference,
    referenceMode: request.mode,
    referenceMethod: request.method,
    currentPeriod: datePeriod(request.currentPoints),
    referencePeriod: datePeriod(request.referencePoints),
    currentSampleSize: current.sampleSize,
    referenceSampleSize: reference.sampleSize,
    status,
    qualityScore: qualityScore(current, reference, periodSizeMismatch),
    warnings: [...warnings].sort(),
    sourceLineageIds: sortedUnique([
      ...request.currentPoints.flatMap((point) => point.sourceLineageIds ?? []),
      ...request.referencePoints.flatMap(
        (point) => point.sourceLineageIds ?? [],
      ),
    ]),
  };
}

interface AggregatedSample {
  readonly value: DecimalString | null;
  readonly status: FormulaStatus;
  readonly sampleSize: number;
  readonly expectedSampleSize: number;
  readonly qualityCoverage: number;
}

function aggregateSample(
  points: readonly DatedKpiValue[],
  aggregation: "SUM" | "AVERAGE",
  expectedSampleSize: number,
): AggregatedSample {
  for (const point of points) validatePoint(point);
  const available = points.filter(isAvailablePoint);
  if (available.length === 0) {
    return {
      value: null,
      status: "UNAVAILABLE",
      sampleSize: 0,
      expectedSampleSize,
      qualityCoverage: 0,
    };
  }
  const values = available.map((point) => point.value);
  const value =
    aggregation === "SUM" ? addDecimals(values) : averageDecimals(values);
  const complete =
    available.length === expectedSampleSize &&
    points.length === expectedSampleSize &&
    available.every((point) => point.status === "AVAILABLE");
  return {
    value,
    status: complete ? "AVAILABLE" : "PARTIAL",
    sampleSize: available.length,
    expectedSampleSize,
    qualityCoverage:
      expectedSampleSize <= 0
        ? 0
        : Math.min(
            1,
            available.reduce(
              (score, point) =>
                score + (point.status === "AVAILABLE" ? 1 : 0.5),
              0,
            ) / expectedSampleSize,
          ),
  };
}

function averageDecimals(values: readonly string[]): DecimalString {
  const parsed = values.map(parseDecimal);
  const scale = parsed.reduce(
    (maximum, item) => Math.max(maximum, item.scale),
    0,
  );
  const total = parsed.reduce(
    (sum, item) => sum.plus(item.value),
    new BusinessDecimal(0),
  );
  return serializeDecimal(total.dividedBy(values.length), scale);
}

function comparisonStatus(
  current: AggregatedSample,
  reference: AggregatedSample,
  mismatch: boolean,
): FormulaStatus {
  if (current.value === null || reference.value === null || mismatch) {
    return "UNAVAILABLE";
  }
  return current.status === "PARTIAL" || reference.status === "PARTIAL"
    ? "PARTIAL"
    : "AVAILABLE";
}

function qualityScore(
  current: AggregatedSample,
  reference: AggregatedSample,
  mismatch: boolean,
): number {
  if (current.value === null || reference.value === null || mismatch) return 0;
  const currentCoverage = sampleCoverage(current);
  const referenceCoverage = sampleCoverage(reference);
  return (
    Math.round(Math.min(currentCoverage, referenceCoverage) * 10_000) / 10_000
  );
}

function sampleCoverage(sample: AggregatedSample): number {
  return sample.qualityCoverage;
}

function isAvailablePoint(
  point: DatedKpiValue,
): point is DatedKpiValue & { value: string } {
  return point.value !== null && point.status !== "UNAVAILABLE";
}

function historyByDate(
  points: readonly DatedKpiValue[],
): ReadonlyMap<string, DatedKpiValue> {
  return new Map(
    uniquePoints(points).map((point) => [point.businessDate, point]),
  );
}

function uniquePoints(
  points: readonly DatedKpiValue[],
): readonly DatedKpiValue[] {
  const byDate = new Map<string, DatedKpiValue>();
  for (const point of points) {
    validatePoint(point);
    if (byDate.has(point.businessDate)) {
      throw new Error(`Duplicate KPI point for ${point.businessDate}.`);
    }
    byDate.set(point.businessDate, point);
  }
  return [...byDate.values()];
}

function validatePoint(point: DatedKpiValue) {
  parseBusinessDate(point.businessDate);
  if (point.value !== null) parseDecimal(point.value);
  if (point.status === "UNAVAILABLE" && point.value !== null) {
    throw new Error("An unavailable KPI point cannot contain a value.");
  }
}

function addUtcDays(date: string, days: number): string {
  const parsed = parseBusinessDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatBusinessDate(parsed);
}

function previousYearDate(date: string): string | null {
  const parsed = parseBusinessDate(date);
  const year = parsed.getUTCFullYear() - 1;
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const candidate = new Date(Date.UTC(year, month, day));
  return candidate.getUTCMonth() === month && candidate.getUTCDate() === day
    ? formatBusinessDate(candidate)
    : null;
}

function weekday(date: string): number {
  return parseBusinessDate(date).getUTCDay();
}

function parseBusinessDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid business date: ${date}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || formatBusinessDate(parsed) !== date) {
    throw new Error(`Invalid business date: ${date}`);
  }
  return parsed;
}

function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function datePeriod(points: readonly DatedKpiValue[]): DatePeriod | null {
  if (points.length === 0) return null;
  const dates = points.map((point) => point.businessDate).sort();
  return { start: dates[0]!, end: dates[dates.length - 1]! };
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
