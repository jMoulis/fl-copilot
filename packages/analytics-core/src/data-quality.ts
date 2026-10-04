import {
  BusinessDecimal,
  normalizeDecimal,
  parseDecimal,
  serializeDecimal,
  subtractDecimals,
  type DecimalString,
} from "./decimal";

export const DATA_QUALITY_COMPONENT_IDS = [
  "sourceCompleteness",
  "productMatchQuality",
  "costCoverage",
  "referenceQuality",
  "periodCompleteness",
  "unitCompatibility",
  "executionDataCompleteness",
  "contextCompleteness",
] as const;

export type DataQualityComponentId =
  (typeof DATA_QUALITY_COMPONENT_IDS)[number];

export type DataQualityStatus = "COMPLETE" | "PARTIAL" | "MISSING";

export type DataQualityWarning =
  | "SOURCE_INCOMPLETE"
  | "PRODUCT_MATCH_INCOMPLETE"
  | "COST_COVERAGE_INCOMPLETE"
  | "REFERENCE_LOW_QUALITY"
  | "PERIOD_INCOMPLETE"
  | "UNIT_INCOMPATIBLE"
  | "EXECUTION_DATA_INCOMPLETE"
  | "CONTEXT_INCOMPLETE";

export interface DataQualityComponent {
  readonly id: DataQualityComponentId;
  readonly score: number;
  readonly status: DataQualityStatus;
  readonly observed: DecimalString;
  readonly expected: DecimalString;
  readonly warning?: DataQualityWarning;
}

export type DataQualityComponents = Readonly<
  Record<DataQualityComponentId, DataQualityComponent | null>
>;

export interface DataQualityResult {
  readonly overallScore: number;
  readonly status: DataQualityStatus;
  readonly components: DataQualityComponents;
  readonly warnings: readonly DataQualityWarning[];
  readonly sourceLineageIds: readonly string[];
}

export interface PeriodCompletenessResult {
  readonly component: DataQualityComponent;
  readonly expectedBusinessDates: readonly string[];
  readonly observedBusinessDates: readonly string[];
  readonly missingBusinessDates: readonly string[];
  readonly unexpectedBusinessDates: readonly string[];
}

export interface WasteCostCoverageResult {
  readonly component: DataQualityComponent;
  readonly eligibleValue: DecimalString;
  readonly knownValue: DecimalString;
  readonly estimatedValue: DecimalString;
  readonly unknownValue: DecimalString;
  readonly knownCoverage: DecimalString;
  readonly estimatedCoverage: DecimalString;
  readonly unknownCoverage: DecimalString;
}

const WARNING_BY_COMPONENT: Readonly<
  Record<DataQualityComponentId, DataQualityWarning>
> = {
  sourceCompleteness: "SOURCE_INCOMPLETE",
  productMatchQuality: "PRODUCT_MATCH_INCOMPLETE",
  costCoverage: "COST_COVERAGE_INCOMPLETE",
  referenceQuality: "REFERENCE_LOW_QUALITY",
  periodCompleteness: "PERIOD_INCOMPLETE",
  unitCompatibility: "UNIT_INCOMPATIBLE",
  executionDataCompleteness: "EXECUTION_DATA_INCOMPLETE",
  contextCompleteness: "CONTEXT_INCOMPLETE",
};

export function createCoverageQualityComponent(
  id: DataQualityComponentId,
  input: {
    readonly observed: string;
    readonly expected: string;
  },
): DataQualityComponent {
  const observed = parseNonNegative(input.observed, "observed");
  const expected = parseNonNegative(input.expected, "expected");
  if (expected.value.isZero()) {
    throw new Error("expected must be greater than zero.");
  }
  if (observed.value.greaterThan(expected.value)) {
    throw new Error("observed must not exceed expected.");
  }

  const score = scoreFromRatio(observed.value, expected.value);
  const status = coverageStatus(observed.value, expected.value);
  return {
    id,
    score,
    status,
    observed: normalizeDecimal(input.observed),
    expected: normalizeDecimal(input.expected),
    ...(status === "COMPLETE" ? {} : { warning: WARNING_BY_COMPONENT[id] }),
  };
}

export function createExplicitQualityComponent(
  id: DataQualityComponentId,
  score: string,
): DataQualityComponent {
  return createCoverageQualityComponent(id, {
    observed: score,
    expected: "1",
  });
}

export function assessPeriodCompleteness(input: {
  readonly expectedBusinessDates: readonly string[];
  readonly observedBusinessDates: readonly string[];
}): PeriodCompletenessResult {
  const expectedBusinessDates = uniqueSortedDates(input.expectedBusinessDates);
  const observedInputDates = uniqueSortedDates(input.observedBusinessDates);
  if (expectedBusinessDates.length === 0) {
    throw new Error(
      "expectedBusinessDates must contain the configured store opening dates.",
    );
  }

  const expected = new Set(expectedBusinessDates);
  const observedBusinessDates = observedInputDates.filter((date) =>
    expected.has(date),
  );
  const observed = new Set(observedBusinessDates);

  return {
    component: createCoverageQualityComponent("periodCompleteness", {
      observed: String(observedBusinessDates.length),
      expected: String(expectedBusinessDates.length),
    }),
    expectedBusinessDates,
    observedBusinessDates,
    missingBusinessDates: expectedBusinessDates.filter(
      (date) => !observed.has(date),
    ),
    unexpectedBusinessDates: observedInputDates.filter(
      (date) => !expected.has(date),
    ),
  };
}

export function assessWasteCostCoverage(input: {
  readonly eligibleValue: string;
  readonly knownValue: string;
  readonly estimatedValue: string;
}): WasteCostCoverageResult {
  const eligible = parseNonNegative(input.eligibleValue, "eligibleValue");
  const known = parseNonNegative(input.knownValue, "knownValue");
  const estimated = parseNonNegative(input.estimatedValue, "estimatedValue");
  if (eligible.value.isZero()) {
    throw new Error("eligibleValue must be greater than zero.");
  }
  if (known.value.plus(estimated.value).greaterThan(eligible.value)) {
    throw new Error(
      "knownValue plus estimatedValue must not exceed eligibleValue.",
    );
  }

  const scale = Math.max(eligible.scale, known.scale, estimated.scale);
  const eligibleValue = serializeDecimal(eligible.value, scale);
  const knownValue = serializeDecimal(known.value, scale);
  const estimatedValue = serializeDecimal(estimated.value, scale);
  const knownAndEstimated = serializeDecimal(
    known.value.plus(estimated.value),
    scale,
  );
  const unknownValue = subtractDecimals(eligibleValue, knownAndEstimated);

  return {
    component: createCoverageQualityComponent("costCoverage", {
      observed: knownValue,
      expected: eligibleValue,
    }),
    eligibleValue,
    knownValue,
    estimatedValue,
    unknownValue,
    knownCoverage: coverageDecimal(known.value, eligible.value),
    estimatedCoverage: coverageDecimal(estimated.value, eligible.value),
    unknownCoverage: coverageDecimal(
      parseDecimal(unknownValue).value,
      eligible.value,
    ),
  };
}

export function buildDataQualityResult(input: {
  readonly components: readonly DataQualityComponent[];
  readonly sourceLineageIds?: readonly string[];
}): DataQualityResult {
  if (input.components.length === 0) {
    throw new Error("At least one data-quality component is required.");
  }
  const componentsById = new Map<
    DataQualityComponentId,
    DataQualityComponent
  >();
  for (const component of input.components) {
    validateComponent(component);
    if (componentsById.has(component.id)) {
      throw new Error(`Duplicate data-quality component: ${component.id}.`);
    }
    componentsById.set(component.id, component);
  }

  const orderedComponents = DATA_QUALITY_COMPONENT_IDS.flatMap((id) => {
    const component = componentsById.get(id);
    return component ? [component] : [];
  });
  const componentRecord = Object.fromEntries(
    DATA_QUALITY_COMPONENT_IDS.map((id) => [
      id,
      componentsById.get(id) ?? null,
    ]),
  ) as DataQualityComponents;
  const totalScore = orderedComponents.reduce(
    (sum, component) => sum.plus(component.score),
    new BusinessDecimal(0),
  );
  const overallScore = Number(
    totalScore.dividedBy(orderedComponents.length).toFixed(4),
  );

  return {
    overallScore,
    status: overallStatus(orderedComponents),
    components: componentRecord,
    warnings: orderedComponents.flatMap((component) =>
      component.warning ? [component.warning] : [],
    ),
    sourceLineageIds: sortedUnique(input.sourceLineageIds ?? []),
  };
}

export function serializeDataQualityResult(result: DataQualityResult): string {
  return JSON.stringify(result);
}

function coverageDecimal(
  observed: InstanceType<typeof BusinessDecimal>,
  expected: InstanceType<typeof BusinessDecimal>,
): DecimalString {
  return serializeDecimal(observed.dividedBy(expected), 4);
}

function scoreFromRatio(
  observed: InstanceType<typeof BusinessDecimal>,
  expected: InstanceType<typeof BusinessDecimal>,
): number {
  return Number(observed.dividedBy(expected).toFixed(4));
}

function overallStatus(
  components: readonly DataQualityComponent[],
): DataQualityStatus {
  if (components.every((component) => component.status === "COMPLETE")) {
    return "COMPLETE";
  }
  if (components.every((component) => component.status === "MISSING")) {
    return "MISSING";
  }
  return "PARTIAL";
}

function validateComponent(component: DataQualityComponent) {
  if (!DATA_QUALITY_COMPONENT_IDS.includes(component.id)) {
    throw new Error(`Unknown data-quality component: ${component.id}.`);
  }
  if (
    !Number.isFinite(component.score) ||
    component.score < 0 ||
    component.score > 1
  ) {
    throw new Error(`Invalid score for ${component.id}.`);
  }
  const observed = parseNonNegative(component.observed, "observed");
  const expected = parseNonNegative(component.expected, "expected");
  if (
    expected.value.isZero() ||
    observed.value.greaterThan(expected.value) ||
    scoreFromRatio(observed.value, expected.value) !== component.score
  ) {
    throw new Error(`Coverage does not match score for ${component.id}.`);
  }
  if (coverageStatus(observed.value, expected.value) !== component.status) {
    throw new Error(`Status does not match coverage for ${component.id}.`);
  }
  const expectedWarning = WARNING_BY_COMPONENT[component.id];
  if (
    (component.status === "COMPLETE" && component.warning !== undefined) ||
    (component.status !== "COMPLETE" && component.warning !== expectedWarning)
  ) {
    throw new Error(`Warning does not match status for ${component.id}.`);
  }
}

function coverageStatus(
  observed: InstanceType<typeof BusinessDecimal>,
  expected: InstanceType<typeof BusinessDecimal>,
): DataQualityStatus {
  if (observed.equals(expected)) return "COMPLETE";
  return observed.isZero() ? "MISSING" : "PARTIAL";
}

function parseNonNegative(value: string, field: string) {
  const parsed = parseDecimal(value);
  if (parsed.value.isNegative()) {
    throw new Error(`${field} must not be negative.`);
  }
  return parsed;
}

function uniqueSortedDates(values: readonly string[]): readonly string[] {
  for (const value of values) validateDate(value);
  return [...new Set(values)].sort();
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid business date: ${value}.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid business date: ${value}.`);
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
