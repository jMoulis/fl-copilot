import { describe, expect, it } from "vitest";
import {
  buildDataQualityResult,
  createExplicitQualityComponent,
} from "./data-quality";
import type { ComparisonResult } from "./comparison";
import { normalizeDecimal } from "./decimal";
import {
  generateInitialAnalyticalCandidates,
  serializeAnalyticalCandidates,
  type InitialCandidateThresholds,
} from "./candidates";

const thresholds: InitialCandidateThresholds = {
  wasteSpike: {
    minimumAbsoluteChange: "10",
    fullScaleAbsoluteChange: "40",
    minimumPercentageChange: "20",
    fullScalePercentageChange: "80",
    urgencyScore: 0.8,
    minimumDataQualityScore: 0.7,
  },
  salesDrop: {
    minimumAbsoluteChange: "50",
    fullScaleAbsoluteChange: "200",
    minimumPercentageChange: "10",
    fullScalePercentageChange: "40",
    urgencyScore: 0.7,
    minimumDataQualityScore: 0.7,
  },
  marginDrop: {
    minimumAbsoluteChange: "20",
    fullScaleAbsoluteChange: "100",
    minimumPercentageChange: "10",
    fullScalePercentageChange: "40",
    urgencyScore: 0.6,
    minimumDataQualityScore: 0.7,
  },
  dataQualityAlertScore: 0.7,
};

type ComparisonOverrides = Omit<
  Partial<ComparisonResult>,
  | "kpiId"
  | "currentValue"
  | "referenceValue"
  | "absoluteDifference"
  | "percentageDifference"
> & {
  readonly kpiId: string;
  readonly currentValue?: string | null;
  readonly referenceValue?: string | null;
  readonly absoluteDifference?: string | null;
  readonly percentageDifference?: string | null;
};

function comparison(overrides: ComparisonOverrides): ComparisonResult {
  const {
    kpiId,
    currentValue = "150",
    referenceValue = "100",
    absoluteDifference = "50",
    percentageDifference = "50.00",
    ...rest
  } = overrides;
  return {
    kpiId,
    currentValue: currentValue === null ? null : normalizeDecimal(currentValue),
    referenceValue:
      referenceValue === null ? null : normalizeDecimal(referenceValue),
    absoluteDifference:
      absoluteDifference === null ? null : normalizeDecimal(absoluteDifference),
    percentageDifference:
      percentageDifference === null
        ? null
        : normalizeDecimal(percentageDifference),
    referenceMode: "J_MINUS_7",
    referenceMethod: "same weekday 7 days earlier",
    currentPeriod: { start: "2026-10-03", end: "2026-10-03" },
    referencePeriod: { start: "2026-09-26", end: "2026-09-26" },
    currentSampleSize: 1,
    referenceSampleSize: 1,
    status: "AVAILABLE",
    qualityScore: 1,
    warnings: [],
    sourceLineageIds: ["comparison-b", "comparison-a"],
    ...rest,
  };
}

function quality(score = "1") {
  return buildDataQualityResult({
    components: [createExplicitQualityComponent("sourceCompleteness", score)],
    sourceLineageIds: ["quality-a"],
  });
}

function input(
  overrides: {
    comparisons?: {
      waste?: ComparisonResult | null;
      sales?: ComparisonResult | null;
      margin?: ComparisonResult | null;
    };
    qualityScore?: string;
  } = {},
) {
  return {
    storeId: "store-1",
    businessDate: "2026-10-03",
    entityType: "PRODUCT" as const,
    entityId: "product-1",
    comparisons: overrides.comparisons ?? {},
    dataQuality: quality(overrides.qualityScore),
    thresholds,
    generatedAt: "2026-10-04T09:00:00.000Z",
  };
}

describe("analytical candidate engine", () => {
  it("generates a deterministic waste spike with structured evidence", () => {
    const [candidate] = generateInitialAnalyticalCandidates(
      input({ comparisons: { waste: comparison({ kpiId: "waste_value" }) } }),
    );

    expect(candidate).toMatchObject({
      id: "candidate:2026-10-03:WASTE_SPIKE:PRODUCT:product-1:waste_value:J_MINUS_7",
      type: "WASTE_SPIKE",
      metricId: "waste_value",
      urgencyScore: 0.8,
      economicImpactScore: 1,
      deviationScore: 0.625,
      dataQualityScore: 1,
      status: "ACTIVE",
      warnings: [],
      sourceLineageIds: ["comparison-a", "comparison-b", "quality-a"],
    });
    expect(candidate?.evidence.map((item) => item.label)).toEqual([
      "CURRENT_VALUE",
      "REFERENCE_VALUE",
      "ABSOLUTE_DIFFERENCE",
      "PERCENTAGE_DIFFERENCE",
      "DATA_QUALITY_SCORE",
    ]);
  });

  it("generates sales and margin drops only in the negative direction", () => {
    const candidates = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          sales: comparison({
            kpiId: "sales_value",
            currentValue: "700",
            referenceValue: "800",
            absoluteDifference: "-100",
            percentageDifference: "-12.50",
          }),
          margin: comparison({
            kpiId: "margin_value",
            currentValue: "180",
            referenceValue: "240",
            absoluteDifference: "-60",
            percentageDifference: "-25.00",
          }),
        },
      }),
    );

    expect(candidates.map((candidate) => candidate.type)).toEqual([
      "SALES_DROP",
      "MARGIN_DROP",
    ]);
    expect(candidates[0]).toMatchObject({
      economicImpactScore: 0.5,
      deviationScore: 0.3125,
    });
    expect(candidates[1]).toMatchObject({
      economicImpactScore: 0.6,
      deviationScore: 0.625,
    });

    const growth = generateInitialAnalyticalCandidates(
      input({ comparisons: { sales: comparison({ kpiId: "sales_value" }) } }),
    );
    expect(growth).toEqual([]);
  });

  it("does not create change candidates below configured impact thresholds", () => {
    const candidates = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          waste: comparison({
            kpiId: "waste_value",
            absoluteDifference: "9",
            percentageDifference: "90",
          }),
          sales: comparison({
            kpiId: "sales_value",
            absoluteDifference: "-100",
            percentageDifference: "-9",
          }),
        },
      }),
    );

    expect(candidates).toEqual([]);
  });

  it("suppresses a change candidate when its reference is unavailable", () => {
    const candidates = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          sales: comparison({
            kpiId: "sales_value",
            currentValue: "700",
            referenceValue: null,
            absoluteDifference: null,
            percentageDifference: null,
            status: "UNAVAILABLE",
            qualityScore: 0,
            warnings: ["MISSING_REFERENCE"],
          }),
        },
      }),
    );

    expect(candidates).toEqual([]);
  });

  it("keeps an extreme signal but flags incomplete source data", () => {
    const candidates = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          waste: comparison({
            kpiId: "waste_value",
            status: "PARTIAL",
            qualityScore: 0.8,
            warnings: ["PARTIAL_CURRENT"],
          }),
        },
        qualityScore: "0.5",
      }),
    );

    expect(candidates.map((candidate) => candidate.type)).toEqual([
      "WASTE_SPIKE",
      "DATA_QUALITY_ALERT",
    ]);
    expect(candidates[0]).toMatchObject({
      dataQualityScore: 0.5,
      status: "LOW_QUALITY",
      warnings: ["LOW_DATA_QUALITY", "PARTIAL_COMPARISON"],
    });
  });

  it("creates a data-quality alert with missing and partial dimensions", () => {
    const dataQuality = buildDataQualityResult({
      components: [
        createExplicitQualityComponent("sourceCompleteness", "0"),
        createExplicitQualityComponent("productMatchQuality", "0.5"),
      ],
      sourceLineageIds: ["import-1"],
    });
    const [alert] = generateInitialAnalyticalCandidates({
      ...input(),
      dataQuality,
    });

    expect(alert).toMatchObject({
      type: "DATA_QUALITY_ALERT",
      urgencyScore: 0.6429,
      economicImpactScore: 0,
      deviationScore: 0.75,
      dataQualityScore: 0.25,
      status: "ACTIVE",
    });
    expect(alert?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "MISSING_COMPONENTS",
          value: "sourceCompleteness",
        }),
        expect.objectContaining({
          label: "PARTIAL_COMPONENTS",
          value: "productMatchQuality",
        }),
      ]),
    );
  });

  it("handles a valid zero reference without inventing a percentage", () => {
    const [candidate] = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          waste: comparison({
            kpiId: "waste_value",
            currentValue: "20",
            referenceValue: "0",
            absoluteDifference: "20",
            percentageDifference: null,
            warnings: ["ZERO_REFERENCE"],
          }),
        },
      }),
    );

    expect(candidate).toMatchObject({
      type: "WASTE_SPIKE",
      deviationScore: 1,
      warnings: ["ZERO_REFERENCE"],
    });
    expect(
      candidate?.evidence.find(
        (evidence) => evidence.label === "PERCENTAGE_DIFFERENCE",
      )?.value,
    ).toBeNull();
  });

  it("serializes candidates in stable type order", () => {
    const candidates = generateInitialAnalyticalCandidates(
      input({
        comparisons: {
          waste: comparison({ kpiId: "waste_value" }),
          sales: comparison({
            kpiId: "sales_value",
            absoluteDifference: "-100",
            percentageDifference: "-20",
          }),
        },
      }),
    );

    expect(serializeAnalyticalCandidates([...candidates].reverse())).toBe(
      serializeAnalyticalCandidates(candidates),
    );
  });

  it("rejects inconsistent threshold configuration", () => {
    expect(() =>
      generateInitialAnalyticalCandidates({
        ...input(),
        thresholds: {
          ...thresholds,
          wasteSpike: {
            ...thresholds.wasteSpike,
            minimumAbsoluteChange: "50",
            fullScaleAbsoluteChange: "40",
          },
        },
      }),
    ).toThrow("fullScaleAbsoluteChange must be at least minimumAbsoluteChange");
  });
});
