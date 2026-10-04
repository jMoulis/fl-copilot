import { describe, expect, it } from "vitest";
import {
  comparisonAvailability,
  computeAverageRealizedPrice,
  computeRatio,
  computeWasteOutputShare,
  sumAvailableCurrency,
  sumAvailableDecimals,
  sumCompatibleQuantities,
} from "./formulas";

describe("initial KPI formulas", () => {
  it("preserves known zero and never turns missing into zero", () => {
    expect(sumAvailableDecimals(["0", "0.00"])).toMatchObject({
      value: "0.00",
      status: "AVAILABLE",
    });
    expect(sumAvailableDecimals([null, undefined])).toMatchObject({
      value: null,
      status: "UNAVAILABLE",
      reason: "MISSING_INPUT",
    });
    expect(sumAvailableCurrency(["0", null])).toMatchObject({
      value: "0.00",
      status: "PARTIAL",
      missingInputCount: 1,
    });
  });

  it("rejects mixed or unknown quantity units", () => {
    expect(
      sumCompatibleQuantities([
        { value: "20", unit: "KG" },
        { value: "3", unit: "PIECE" },
      ]),
    ).toMatchObject({
      value: null,
      unit: null,
      reason: "INCOMPATIBLE_UNITS",
    });
    expect(
      sumCompatibleQuantities([{ value: "20", unit: "UNKNOWN" }]),
    ).toMatchObject({ value: null, reason: "UNKNOWN_UNIT" });
  });

  it("sums compatible quantities without losing scale", () => {
    expect(
      sumCompatibleQuantities([
        { value: "0.580", unit: "KG" },
        { value: "4.88", unit: "KG" },
      ]),
    ).toMatchObject({ value: "5.460", unit: "KG", status: "AVAILABLE" });
  });

  it("computes ratios only from present inputs and a positive denominator", () => {
    expect(computeRatio("20", "100", 4)).toMatchObject({
      value: "0.2000",
      status: "AVAILABLE",
    });
    expect(computeRatio("0", "100", 4)).toMatchObject({
      value: "0.0000",
      status: "AVAILABLE",
    });
    expect(computeRatio("20", null, 4)).toMatchObject({
      value: null,
      reason: "MISSING_INPUT",
    });
    expect(computeRatio("20", "0", 4)).toMatchObject({
      value: null,
      reason: "NON_POSITIVE_DENOMINATOR",
    });
  });

  it("derives average realized price from sums rather than line averages", () => {
    expect(
      computeAverageRealizedPrice(
        ["100", "50"],
        [
          { value: "20", unit: "KG" },
          { value: "5", unit: "KG" },
        ],
      ),
    ).toMatchObject({ value: "6.00", unit: "KG", status: "AVAILABLE" });
  });

  it("keeps known and estimated waste costs independently aggregatable", () => {
    const known = sumAvailableCurrency(["100", null]);
    const estimated = sumAvailableCurrency([null, "20"]);
    expect(known.value).toBe("100.00");
    expect(estimated.value).toBe("20.00");
    expect(known.status).toBe("PARTIAL");
    expect(estimated.status).toBe("PARTIAL");
  });

  it("computes output waste share only for compatible units", () => {
    const sold = sumCompatibleQuantities([{ value: "80", unit: "KG" }]);
    const waste = sumCompatibleQuantities([{ value: "20", unit: "KG" }]);
    expect(computeWasteOutputShare(sold, waste)).toMatchObject({
      value: "0.2000",
      status: "AVAILABLE",
    });

    const pieces = sumCompatibleQuantities([{ value: "20", unit: "PIECE" }]);
    expect(computeWasteOutputShare(sold, pieces)).toMatchObject({
      value: null,
      reason: "INCOMPATIBLE_UNITS",
    });
  });

  it("marks a missing comparison reference unavailable rather than zero", () => {
    expect(comparisonAvailability("100", null)).toEqual({
      status: "UNAVAILABLE",
      reason: "MISSING_REFERENCE",
    });
    expect(comparisonAvailability("0", "0")).toEqual({ status: "AVAILABLE" });
  });
});
