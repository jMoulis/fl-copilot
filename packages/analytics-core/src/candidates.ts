import { BusinessDecimal, parseDecimal } from "./decimal";
import type { ComparisonResult } from "./comparison";
import type { DataQualityResult } from "./data-quality";

export const INITIAL_ANALYTICAL_CANDIDATE_TYPES = [
  "WASTE_SPIKE",
  "SALES_DROP",
  "MARGIN_DROP",
  "DATA_QUALITY_ALERT",
] as const;

export type InitialAnalyticalCandidateType =
  (typeof INITIAL_ANALYTICAL_CANDIDATE_TYPES)[number];

export type AnalyticalEntityType =
  "PRODUCT" | "CATEGORY" | "COMMERCIAL_OPERATION" | "SUBSTITUTION_RELATION";

export type AnalyticalCandidateStatus = "ACTIVE" | "LOW_QUALITY";

export type AnalyticalCandidateWarning =
  "LOW_DATA_QUALITY" | "PARTIAL_COMPARISON" | "ZERO_REFERENCE";

export interface AnalyticalEvidence {
  readonly label: string;
  readonly value?: number | string | null;
  readonly sourceType:
    | "KPI"
    | "COMPARISON"
    | "EVENT"
    | "COMMERCIAL_OPERATION"
    | "SUBSTITUTION"
    | "DATA_QUALITY";
  readonly sourceId: string;
}

export interface AnalyticalCandidate {
  readonly id: string;
  readonly storeId: string;
  readonly businessDate: string;
  readonly type: InitialAnalyticalCandidateType;
  readonly entityType: AnalyticalEntityType;
  readonly entityId: string;
  readonly metricId: string;
  readonly urgencyScore: number;
  readonly economicImpactScore: number;
  readonly deviationScore: number;
  readonly dataQualityScore: number;
  readonly status: AnalyticalCandidateStatus;
  readonly warnings: readonly AnalyticalCandidateWarning[];
  readonly evidence: readonly AnalyticalEvidence[];
  readonly sourceLineageIds: readonly string[];
  readonly generatedAt: string;
}

export interface ChangeCandidateThreshold {
  readonly minimumAbsoluteChange: string;
  readonly fullScaleAbsoluteChange: string;
  readonly minimumPercentageChange: string;
  readonly fullScalePercentageChange: string;
  readonly urgencyScore: number;
  readonly minimumDataQualityScore: number;
}

export interface InitialCandidateThresholds {
  readonly wasteSpike: ChangeCandidateThreshold;
  readonly salesDrop: ChangeCandidateThreshold;
  readonly marginDrop: ChangeCandidateThreshold;
  readonly dataQualityAlertScore: number;
}

export interface InitialCandidateInput {
  readonly storeId: string;
  readonly businessDate: string;
  readonly entityType: AnalyticalEntityType;
  readonly entityId: string;
  readonly comparisons: {
    readonly waste?: ComparisonResult | null;
    readonly sales?: ComparisonResult | null;
    readonly margin?: ComparisonResult | null;
  };
  readonly dataQuality: DataQualityResult;
  readonly thresholds: InitialCandidateThresholds;
  readonly generatedAt: string;
}

export function generateInitialAnalyticalCandidates(
  input: InitialCandidateInput,
): readonly AnalyticalCandidate[] {
  validateCandidateInput(input);
  const candidates = [
    input.comparisons.waste
      ? buildChangeCandidate({
          ...baseInput(input),
          type: "WASTE_SPIKE",
          direction: "INCREASE",
          comparison: input.comparisons.waste,
          threshold: input.thresholds.wasteSpike,
        })
      : null,
    input.comparisons.sales
      ? buildChangeCandidate({
          ...baseInput(input),
          type: "SALES_DROP",
          direction: "DECREASE",
          comparison: input.comparisons.sales,
          threshold: input.thresholds.salesDrop,
        })
      : null,
    input.comparisons.margin
      ? buildChangeCandidate({
          ...baseInput(input),
          type: "MARGIN_DROP",
          direction: "DECREASE",
          comparison: input.comparisons.margin,
          threshold: input.thresholds.marginDrop,
        })
      : null,
    buildDataQualityAlert({
      ...baseInput(input),
      alertBelowScore: input.thresholds.dataQualityAlertScore,
    }),
  ];

  return candidates.filter(
    (candidate): candidate is AnalyticalCandidate => candidate !== null,
  );
}

export function buildChangeCandidate(input: {
  readonly storeId: string;
  readonly businessDate: string;
  readonly entityType: AnalyticalEntityType;
  readonly entityId: string;
  readonly type: Exclude<InitialAnalyticalCandidateType, "DATA_QUALITY_ALERT">;
  readonly direction: "INCREASE" | "DECREASE";
  readonly comparison: ComparisonResult;
  readonly dataQuality: DataQualityResult;
  readonly threshold: ChangeCandidateThreshold;
  readonly generatedAt: string;
}): AnalyticalCandidate | null {
  validateThreshold(input.threshold);
  if (
    input.comparison.status === "UNAVAILABLE" ||
    input.comparison.absoluteDifference === null
  ) {
    return null;
  }

  const difference = parseDecimal(input.comparison.absoluteDifference).value;
  if (
    (input.direction === "INCREASE" && !difference.isPositive()) ||
    (input.direction === "DECREASE" && !difference.isNegative())
  ) {
    return null;
  }

  const absoluteMagnitude = difference.abs();
  const minimumAbsolute = positiveDecimal(
    input.threshold.minimumAbsoluteChange,
    "minimumAbsoluteChange",
  );
  if (absoluteMagnitude.lessThan(minimumAbsolute)) return null;

  const percentageMagnitude = percentageMagnitudeOf(input.comparison);
  const minimumPercentage = positiveDecimal(
    input.threshold.minimumPercentageChange,
    "minimumPercentageChange",
  );
  const zeroReference = input.comparison.warnings.includes("ZERO_REFERENCE");
  if (
    percentageMagnitude === null
      ? !zeroReference
      : percentageMagnitude.lessThan(minimumPercentage)
  ) {
    return null;
  }

  const dataQualityScore = combinedDataQualityScore(
    input.comparison,
    input.dataQuality,
  );
  const warnings = changeWarnings(
    input.comparison,
    dataQualityScore,
    input.threshold.minimumDataQualityScore,
  );
  const comparisonSourceId = comparisonId(input.comparison);

  return {
    id: candidateId(input, input.comparison),
    storeId: input.storeId,
    businessDate: input.businessDate,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    metricId: input.comparison.kpiId,
    urgencyScore: input.threshold.urgencyScore,
    economicImpactScore: normalizedScore(
      absoluteMagnitude,
      positiveDecimal(
        input.threshold.fullScaleAbsoluteChange,
        "fullScaleAbsoluteChange",
      ),
    ),
    deviationScore:
      percentageMagnitude === null
        ? 1
        : normalizedScore(
            percentageMagnitude,
            positiveDecimal(
              input.threshold.fullScalePercentageChange,
              "fullScalePercentageChange",
            ),
          ),
    dataQualityScore,
    status: warnings.includes("LOW_DATA_QUALITY") ? "LOW_QUALITY" : "ACTIVE",
    warnings,
    evidence: [
      {
        label: "CURRENT_VALUE",
        value: input.comparison.currentValue,
        sourceType: "KPI",
        sourceId: input.comparison.kpiId,
      },
      {
        label: "REFERENCE_VALUE",
        value: input.comparison.referenceValue,
        sourceType: "COMPARISON",
        sourceId: comparisonSourceId,
      },
      {
        label: "ABSOLUTE_DIFFERENCE",
        value: input.comparison.absoluteDifference,
        sourceType: "COMPARISON",
        sourceId: comparisonSourceId,
      },
      {
        label: "PERCENTAGE_DIFFERENCE",
        value: input.comparison.percentageDifference,
        sourceType: "COMPARISON",
        sourceId: comparisonSourceId,
      },
      {
        label: "DATA_QUALITY_SCORE",
        value: dataQualityScore,
        sourceType: "DATA_QUALITY",
        sourceId: dataQualityId(input.dataQuality),
      },
    ],
    sourceLineageIds: sortedUnique([
      ...input.comparison.sourceLineageIds,
      ...input.dataQuality.sourceLineageIds,
    ]),
    generatedAt: input.generatedAt,
  };
}

export function buildDataQualityAlert(input: {
  readonly storeId: string;
  readonly businessDate: string;
  readonly entityType: AnalyticalEntityType;
  readonly entityId: string;
  readonly dataQuality: DataQualityResult;
  readonly alertBelowScore: number;
  readonly generatedAt: string;
}): AnalyticalCandidate | null {
  validateScore(input.alertBelowScore, "alertBelowScore", false);
  if (input.dataQuality.overallScore >= input.alertBelowScore) return null;

  const missingComponents = Object.values(input.dataQuality.components)
    .filter((component) => component?.status === "MISSING")
    .map((component) => component!.id);
  const partialComponents = Object.values(input.dataQuality.components)
    .filter((component) => component?.status === "PARTIAL")
    .map((component) => component!.id);

  return {
    id: `candidate:${input.businessDate}:DATA_QUALITY_ALERT:${input.entityType}:${input.entityId}`,
    storeId: input.storeId,
    businessDate: input.businessDate,
    type: "DATA_QUALITY_ALERT",
    entityType: input.entityType,
    entityId: input.entityId,
    metricId: "data_quality",
    urgencyScore: roundedScore(
      new BusinessDecimal(input.alertBelowScore)
        .minus(input.dataQuality.overallScore)
        .dividedBy(input.alertBelowScore),
    ),
    economicImpactScore: 0,
    deviationScore: roundedScore(
      new BusinessDecimal(1).minus(input.dataQuality.overallScore),
    ),
    dataQualityScore: input.dataQuality.overallScore,
    status: "ACTIVE",
    warnings: [],
    evidence: [
      {
        label: "DATA_QUALITY_SCORE",
        value: input.dataQuality.overallScore,
        sourceType: "DATA_QUALITY",
        sourceId: dataQualityId(input.dataQuality),
      },
      {
        label: "MISSING_COMPONENTS",
        value: missingComponents.join(","),
        sourceType: "DATA_QUALITY",
        sourceId: dataQualityId(input.dataQuality),
      },
      {
        label: "PARTIAL_COMPONENTS",
        value: partialComponents.join(","),
        sourceType: "DATA_QUALITY",
        sourceId: dataQualityId(input.dataQuality),
      },
    ],
    sourceLineageIds: input.dataQuality.sourceLineageIds,
    generatedAt: input.generatedAt,
  };
}

export function serializeAnalyticalCandidates(
  candidates: readonly AnalyticalCandidate[],
): string {
  return JSON.stringify([...candidates].sort(compareCandidates));
}

function baseInput(input: InitialCandidateInput) {
  return {
    storeId: input.storeId,
    businessDate: input.businessDate,
    entityType: input.entityType,
    entityId: input.entityId,
    dataQuality: input.dataQuality,
    generatedAt: input.generatedAt,
  };
}

function validateCandidateInput(input: InitialCandidateInput) {
  if (input.storeId.trim().length === 0 || input.entityId.trim().length === 0) {
    throw new Error("storeId and entityId are required.");
  }
  validateBusinessDate(input.businessDate);
  validateScore(
    input.thresholds.dataQualityAlertScore,
    "dataQualityAlertScore",
    false,
  );
  validateThreshold(input.thresholds.wasteSpike);
  validateThreshold(input.thresholds.salesDrop);
  validateThreshold(input.thresholds.marginDrop);
}

function validateThreshold(threshold: ChangeCandidateThreshold) {
  const minimumAbsolute = positiveDecimal(
    threshold.minimumAbsoluteChange,
    "minimumAbsoluteChange",
  );
  const fullAbsolute = positiveDecimal(
    threshold.fullScaleAbsoluteChange,
    "fullScaleAbsoluteChange",
  );
  const minimumPercentage = positiveDecimal(
    threshold.minimumPercentageChange,
    "minimumPercentageChange",
  );
  const fullPercentage = positiveDecimal(
    threshold.fullScalePercentageChange,
    "fullScalePercentageChange",
  );
  if (fullAbsolute.lessThan(minimumAbsolute)) {
    throw new Error(
      "fullScaleAbsoluteChange must be at least minimumAbsoluteChange.",
    );
  }
  if (fullPercentage.lessThan(minimumPercentage)) {
    throw new Error(
      "fullScalePercentageChange must be at least minimumPercentageChange.",
    );
  }
  validateScore(threshold.urgencyScore, "urgencyScore", true);
  validateScore(
    threshold.minimumDataQualityScore,
    "minimumDataQualityScore",
    true,
  );
}

function percentageMagnitudeOf(
  comparison: ComparisonResult,
): InstanceType<typeof BusinessDecimal> | null {
  return comparison.percentageDifference === null
    ? null
    : parseDecimal(comparison.percentageDifference).value.abs();
}

function combinedDataQualityScore(
  comparison: ComparisonResult,
  dataQuality: DataQualityResult,
): number {
  return Number(
    BusinessDecimal.min(
      comparison.qualityScore,
      dataQuality.overallScore,
    ).toFixed(4),
  );
}

function changeWarnings(
  comparison: ComparisonResult,
  dataQualityScore: number,
  minimumDataQualityScore: number,
): readonly AnalyticalCandidateWarning[] {
  const warnings: AnalyticalCandidateWarning[] = [];
  if (dataQualityScore < minimumDataQualityScore) {
    warnings.push("LOW_DATA_QUALITY");
  }
  if (comparison.status === "PARTIAL") warnings.push("PARTIAL_COMPARISON");
  if (comparison.warnings.includes("ZERO_REFERENCE")) {
    warnings.push("ZERO_REFERENCE");
  }
  return warnings;
}

function normalizedScore(
  magnitude: InstanceType<typeof BusinessDecimal>,
  fullScale: InstanceType<typeof BusinessDecimal>,
): number {
  return roundedScore(BusinessDecimal.min(magnitude.dividedBy(fullScale), 1));
}

function roundedScore(value: InstanceType<typeof BusinessDecimal>): number {
  return Number(value.toFixed(4));
}

function positiveDecimal(value: string, field: string) {
  const parsed = parseDecimal(value).value;
  if (!parsed.isPositive()) throw new Error(`${field} must be positive.`);
  return parsed;
}

function validateScore(value: number, field: string, allowZero: boolean) {
  if (
    !Number.isFinite(value) ||
    value > 1 ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new Error(
      `${field} must be ${allowZero ? "between 0 and 1" : "greater than 0 and at most 1"}.`,
    );
  }
}

function candidateId(
  input: {
    readonly businessDate: string;
    readonly type: InitialAnalyticalCandidateType;
    readonly entityType: AnalyticalEntityType;
    readonly entityId: string;
  },
  comparison: ComparisonResult,
) {
  return `candidate:${input.businessDate}:${input.type}:${input.entityType}:${input.entityId}:${comparison.kpiId}:${comparison.referenceMode}`;
}

function comparisonId(comparison: ComparisonResult) {
  const referencePeriod = comparison.referencePeriod
    ? `${comparison.referencePeriod.start}_${comparison.referencePeriod.end}`
    : "missing";
  return `${comparison.kpiId}:${comparison.referenceMode}:${referencePeriod}`;
}

function dataQualityId(dataQuality: DataQualityResult) {
  return `data-quality:${dataQuality.sourceLineageIds.join("|") || "no-lineage"}`;
}

function compareCandidates(
  left: AnalyticalCandidate,
  right: AnalyticalCandidate,
) {
  const typeDifference =
    INITIAL_ANALYTICAL_CANDIDATE_TYPES.indexOf(left.type) -
    INITIAL_ANALYTICAL_CANDIDATE_TYPES.indexOf(right.type);
  return typeDifference || left.id.localeCompare(right.id);
}

function validateBusinessDate(value: string) {
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
