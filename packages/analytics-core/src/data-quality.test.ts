import { describe, expect, it } from "vitest";
import {
  assessPeriodCompleteness,
  assessWasteCostCoverage,
  buildDataQualityResult,
  createCoverageQualityComponent,
  createExplicitQualityComponent,
  serializeDataQualityResult,
} from "./data-quality";

describe("data-quality engine", () => {
  it("returns complete quality when every applicable component is complete", () => {
    const result = buildDataQualityResult({
      components: [
        createCoverageQualityComponent("sourceCompleteness", {
          observed: "147",
          expected: "147",
        }),
        createCoverageQualityComponent("productMatchQuality", {
          observed: "147",
          expected: "147",
        }),
        createExplicitQualityComponent("referenceQuality", "1"),
      ],
      sourceLineageIds: ["import-b", "import-a", "import-a"],
    });

    expect(result).toMatchObject({
      overallScore: 1,
      status: "COMPLETE",
      warnings: [],
      sourceLineageIds: ["import-a", "import-b"],
    });
    expect(result.components.costCoverage).toBeNull();
  });

  it("reflects a partial local import in source quality", () => {
    const source = createCoverageQualityComponent("sourceCompleteness", {
      observed: "75",
      expected: "100",
    });
    const result = buildDataQualityResult({ components: [source] });

    expect(source).toEqual({
      id: "sourceCompleteness",
      score: 0.75,
      status: "PARTIAL",
      observed: "75",
      expected: "100",
      warning: "SOURCE_INCOMPLETE",
    });
    expect(result).toMatchObject({
      overallScore: 0.75,
      status: "PARTIAL",
      warnings: ["SOURCE_INCOMPLETE"],
    });
  });

  it("keeps missing coverage distinct from complete coverage", () => {
    const missing = createCoverageQualityComponent("productMatchQuality", {
      observed: "0",
      expected: "12",
    });

    expect(missing).toMatchObject({
      score: 0,
      status: "MISSING",
      warning: "PRODUCT_MATCH_INCOMPLETE",
    });
    expect(
      createExplicitQualityComponent("referenceQuality", "1"),
    ).toMatchObject({
      score: 1,
      status: "COMPLETE",
    });

    expect(
      createCoverageQualityComponent("sourceCompleteness", {
        observed: "99999",
        expected: "100000",
      }),
    ).toMatchObject({
      score: 1,
      status: "PARTIAL",
      warning: "SOURCE_INCOMPLETE",
    });
  });

  it("uses configured opening dates for period completeness", () => {
    const result = assessPeriodCompleteness({
      expectedBusinessDates: [
        "2026-09-26",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
      ],
      observedBusinessDates: [
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-26",
        "2026-09-26",
        "2026-09-27",
      ],
    });

    expect(result.component).toMatchObject({
      score: 0.8333,
      status: "PARTIAL",
      observed: "5",
      expected: "6",
      warning: "PERIOD_INCOMPLETE",
    });
    expect(result.missingBusinessDates).toEqual(["2026-09-25"]);
    expect(result.unexpectedBusinessDates).toEqual(["2026-09-27"]);
  });

  it("keeps known, estimated and unknown waste cost coverage separate", () => {
    const result = assessWasteCostCoverage({
      eligibleValue: "100.00",
      knownValue: "80.00",
      estimatedValue: "10.00",
    });

    expect(result).toMatchObject({
      eligibleValue: "100.00",
      knownValue: "80.00",
      estimatedValue: "10.00",
      unknownValue: "10.00",
      knownCoverage: "0.8000",
      estimatedCoverage: "0.1000",
      unknownCoverage: "0.1000",
    });
    expect(result.component).toMatchObject({
      score: 0.8,
      status: "PARTIAL",
      warning: "COST_COVERAGE_INCOMPLETE",
    });
  });

  it("averages applicable components without treating omitted dimensions as zero", () => {
    const result = buildDataQualityResult({
      components: [
        createExplicitQualityComponent("sourceCompleteness", "0.75"),
        createExplicitQualityComponent("productMatchQuality", "1"),
        createExplicitQualityComponent("periodCompleteness", "1"),
      ],
    });

    expect(result.overallScore).toBe(0.9167);
    expect(result.status).toBe("PARTIAL");
    expect(result.components.costCoverage).toBeNull();
  });

  it("serializes identically regardless of component and lineage input order", () => {
    const source = createExplicitQualityComponent("sourceCompleteness", "0.75");
    const period = createExplicitQualityComponent("periodCompleteness", "1");
    const forward = buildDataQualityResult({
      components: [source, period],
      sourceLineageIds: ["b", "a"],
    });
    const reversed = buildDataQualityResult({
      components: [period, source],
      sourceLineageIds: ["a", "b"],
    });

    expect(serializeDataQualityResult(reversed)).toBe(
      serializeDataQualityResult(forward),
    );
  });

  it("rejects invalid coverage and duplicated components", () => {
    expect(() =>
      createCoverageQualityComponent("sourceCompleteness", {
        observed: "11",
        expected: "10",
      }),
    ).toThrow("observed must not exceed expected");
    expect(() =>
      createCoverageQualityComponent("sourceCompleteness", {
        observed: "0",
        expected: "0",
      }),
    ).toThrow("expected must be greater than zero");

    const source = createExplicitQualityComponent("sourceCompleteness", "0.5");
    expect(() =>
      buildDataQualityResult({ components: [source, source] }),
    ).toThrow("Duplicate data-quality component");
    expect(() => buildDataQualityResult({ components: [] })).toThrow(
      "At least one data-quality component",
    );
  });

  it("rejects impossible cost totals and requires an explicit opening calendar", () => {
    expect(() =>
      assessWasteCostCoverage({
        eligibleValue: "100",
        knownValue: "80",
        estimatedValue: "30",
      }),
    ).toThrow("must not exceed eligibleValue");
    expect(() =>
      assessPeriodCompleteness({
        expectedBusinessDates: [],
        observedBusinessDates: ["2026-09-21"],
      }),
    ).toThrow("configured store opening dates");
  });
});
