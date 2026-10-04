import { describe, expect, it } from "vitest";
import {
  compareAveragePreviousSameWeekday,
  compareBeforeOperation,
  compareJMinus7,
  comparePreviousComparableWeek,
  compareYearOverYear,
  serializeComparisonResult,
  type DatedKpiValue,
} from "./comparison";

const available = (
  businessDate: string,
  value: string,
  sourceLineageIds: readonly string[] = [],
): DatedKpiValue => ({
  businessDate,
  value,
  status: "AVAILABLE",
  sourceLineageIds,
});

const unavailable = (businessDate: string): DatedKpiValue => ({
  businessDate,
  value: null,
  status: "UNAVAILABLE",
});

describe("comparison engine", () => {
  it("computes J-7 from the exact same weekday", () => {
    const result = compareJMinus7({
      kpiId: "sales_value",
      current: available("2026-09-23", "100.00", ["current"]),
      history: [available("2026-09-16", "80.00", ["reference"])],
    });

    expect(result).toMatchObject({
      currentValue: "100.00",
      referenceValue: "80.00",
      absoluteDifference: "20.00",
      percentageDifference: "25.00",
      referenceMode: "J_MINUS_7",
      referenceSampleSize: 1,
      status: "AVAILABLE",
      qualityScore: 1,
      warnings: [],
    });
    expect(result.referencePeriod).toEqual({
      start: "2026-09-16",
      end: "2026-09-16",
    });
    expect(result.sourceLineageIds).toEqual(["current", "reference"]);
  });

  it("marks a missing J-7 reference unavailable rather than zero", () => {
    const result = compareJMinus7({
      kpiId: "sales_value",
      current: available("2026-09-23", "100.00"),
      history: [],
    });

    expect(result).toMatchObject({
      referenceValue: null,
      absoluteDifference: null,
      percentageDifference: null,
      referenceSampleSize: 0,
      status: "UNAVAILABLE",
      qualityScore: 0,
      warnings: ["MISSING_REFERENCE"],
    });
  });

  it("keeps absolute variation but withholds percentage for a zero reference", () => {
    const result = compareJMinus7({
      kpiId: "sales_value",
      current: available("2026-09-23", "100.00"),
      history: [available("2026-09-16", "0.00")],
    });

    expect(result.absoluteDifference).toBe("100.00");
    expect(result.percentageDifference).toBeNull();
    expect(result.status).toBe("AVAILABLE");
    expect(result.warnings).toContain("ZERO_REFERENCE");
  });

  it("uses the actual available same-weekday sample size", () => {
    const result = compareAveragePreviousSameWeekday({
      kpiId: "sales_value",
      current: available("2026-09-23", "99.00"),
      history: [
        available("2026-09-16", "80.00"),
        available("2026-09-09", "100.00"),
        unavailable("2026-09-02"),
        available("2026-09-15", "1000.00"),
      ],
      targetSampleSize: 4,
    });

    expect(result).toMatchObject({
      referenceValue: "90.00",
      absoluteDifference: "9.00",
      percentageDifference: "10.00",
      referenceSampleSize: 2,
      status: "PARTIAL",
      qualityScore: 0.5,
    });
    expect(result.referenceMethod).toBe(
      "average of 2 available previous same weekdays (target 4)",
    );
    expect(result.warnings).toContain("PARTIAL_REFERENCE");
  });

  it("compares equivalent previous-week samples and rejects unequal periods", () => {
    const current = period("2026-09-21", ["100", "110", "90"]);
    const reference = period("2026-09-14", ["80", "100", "70"]);
    const result = comparePreviousComparableWeek({
      kpiId: "sales_value",
      currentPeriod: current,
      previousPeriod: reference,
    });

    expect(result).toMatchObject({
      currentValue: "300",
      referenceValue: "250",
      absoluteDifference: "50",
      percentageDifference: "20.00",
      currentSampleSize: 3,
      referenceSampleSize: 3,
      status: "AVAILABLE",
    });

    const mismatched = comparePreviousComparableWeek({
      kpiId: "sales_value",
      currentPeriod: current,
      previousPeriod: [
        reference[0]!,
        reference[1]!,
        available("2026-09-10", "20"),
      ],
    });
    expect(mismatched.status).toBe("UNAVAILABLE");
    expect(mismatched.absoluteDifference).toBeNull();
    expect(mismatched.warnings).toContain("SAMPLE_SIZE_MISMATCH");
  });

  it("uses real year-over-year history and never synthesizes it", () => {
    const current = available("2026-09-23", "110.00");
    expect(
      compareYearOverYear({
        kpiId: "sales_value",
        current,
        history: [available("2025-09-23", "100.00")],
      }),
    ).toMatchObject({
      referenceValue: "100.00",
      percentageDifference: "10.00",
      status: "AVAILABLE",
    });
    expect(
      compareYearOverYear({ kpiId: "sales_value", current, history: [] }),
    ).toMatchObject({
      referenceValue: null,
      status: "UNAVAILABLE",
      warnings: ["MISSING_REFERENCE"],
    });
  });

  it("stores the exact before-operation method and requires comparable days", () => {
    const result = compareBeforeOperation({
      kpiId: "sales_value",
      operationPeriod: period("2026-09-21", ["100", "110"]),
      baselinePeriod: period("2026-09-14", ["80", "90"]),
      referenceMethod: "2 same weekdays immediately before operation",
    });
    expect(result.referenceMethod).toBe(
      "2 same weekdays immediately before operation",
    );
    expect(result.status).toBe("AVAILABLE");

    const mismatched = compareBeforeOperation({
      kpiId: "sales_value",
      operationPeriod: period("2026-09-21", ["100", "110"]),
      baselinePeriod: period("2026-09-14", ["80"]),
      referenceMethod: "available weekdays before operation",
    });
    expect(mismatched.status).toBe("UNAVAILABLE");
    expect(mismatched.warnings).toContain("SAMPLE_SIZE_MISMATCH");
  });

  it("serializes period comparisons independently of input ordering", () => {
    const current = period("2026-09-21", ["100", "110", "90"]);
    const reference = period("2026-09-14", ["80", "100", "70"]);
    const forward = comparePreviousComparableWeek({
      kpiId: "sales_value",
      currentPeriod: current,
      previousPeriod: reference,
    });
    const reversed = comparePreviousComparableWeek({
      kpiId: "sales_value",
      currentPeriod: [...current].reverse(),
      previousPeriod: [...reference].reverse(),
    });
    expect(serializeComparisonResult(reversed)).toBe(
      serializeComparisonResult(forward),
    );
  });

  it("reduces quality when a contributing point is partial", () => {
    const result = compareJMinus7({
      kpiId: "sales_value",
      current: available("2026-09-23", "100"),
      history: [
        {
          businessDate: "2026-09-16",
          value: "80",
          status: "PARTIAL",
        },
      ],
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.qualityScore).toBe(0.5);
    expect(result.warnings).toContain("PARTIAL_REFERENCE");
  });

  it("rejects duplicate dates and invalid unavailable points", () => {
    expect(() =>
      comparePreviousComparableWeek({
        kpiId: "sales_value",
        currentPeriod: [
          available("2026-09-21", "100"),
          available("2026-09-21", "120"),
        ],
        previousPeriod: [],
      }),
    ).toThrow("Duplicate KPI point");

    expect(() =>
      compareJMinus7({
        kpiId: "sales_value",
        current: {
          businessDate: "2026-09-23",
          value: "100",
          status: "UNAVAILABLE",
        },
        history: [],
      }),
    ).toThrow("cannot contain a value");
  });
});

function period(startDate: string, values: readonly string[]): DatedKpiValue[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  return values.map((value, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return available(date.toISOString().slice(0, 10), value);
  });
}
