import { it, expect } from "vitest";
import {
  priceScenarioInputSchema,
  priceScenarioResultSchema,
  type PriceScenarioInput,
} from "@fl-copilot/domain";
import { calculatePriceScenario } from "./price-scenario";
import { BusinessDecimal } from "./decimal";
function fixture(unit: "KG" | "PIECE" | "PACK" = "KG"): PriceScenarioInput {
  const quote = (amount: string) => ({
    amount,
    unit,
    currency: "EUR" as const,
    taxBasis: "EXCLUDING_VAT" as const,
  });
  return {
    currentPrice: quote("3"),
    proposedPrice: quote("2.5"),
    purchaseCost: { ...quote("1"), quality: "KNOWN" },
    currentVolume: { amount: "100", unit },
  };
}
it("computes a contribution-preservation threshold and separately rounds up output quantities", () => {
  const input = fixture();
  const r = calculatePriceScenario(input);
  expect(r).toMatchObject({
    status: "AVAILABLE",
    kind: "THEORETICAL_CONTRIBUTION_THRESHOLD",
    isDemandForecast: false,
    label: "Contribution théorique hors TVA",
    warning: "Ce seuil n’est pas une prévision de demande.",
    assumptions: input,
  });
  expect(r.numbers).toEqual({
    unit: "KG",
    currentUnitContribution: "2",
    proposedUnitContribution: "1.5",
    currentContributionAmount: "200",
    approximateRequiredVolume: "133.333333",
    approximateVolumeChangePct: "33.33",
    roundedUpRequiredVolume: "133.334",
    roundedUpVolumeChangePct: "33.33",
    roundingIncrement: "0.001",
    approximateVolumeScale: 6,
    percentageScale: 2,
  });
  expect(input).toEqual(fixture());
  expect(calculatePriceScenario(input)).toEqual(r);
});
it.each(["PIECE", "PACK"] as const)(
  "never rounds fractional count thresholds down (%s)",
  (unit) => {
    expect(calculatePriceScenario(fixture(unit)).numbers).toMatchObject({
      approximateRequiredVolume: "133.333333",
      approximateVolumeChangePct: "33.33",
      roundedUpRequiredVolume: "134",
      roundedUpVolumeChangePct: "34.00",
      roundingIncrement: "1",
    });
  },
);
it("handles an unchanged price, a higher price, a declared zero cost and fractional weight", () => {
  const input = fixture();
  expect(
    calculatePriceScenario({ ...input, proposedPrice: input.currentPrice })
      .numbers,
  ).toMatchObject({
    roundedUpRequiredVolume: "100.000",
    approximateVolumeChangePct: "0.00",
  });
  expect(
    calculatePriceScenario({
      ...input,
      proposedPrice: { ...input.proposedPrice, amount: "4" },
    }).numbers,
  ).toMatchObject({
    approximateRequiredVolume: "66.666667",
    roundedUpRequiredVolume: "66.667",
    approximateVolumeChangePct: "-33.33",
  });
  expect(
    calculatePriceScenario({
      ...input,
      purchaseCost: { ...input.purchaseCost, amount: "0" },
    }).numbers,
  ).toMatchObject({
    currentContributionAmount: "300",
    roundedUpRequiredVolume: "120.000",
  });
  expect(
    calculatePriceScenario({
      ...input,
      currentVolume: { ...input.currentVolume, amount: "1.234" },
    }).numbers,
  ).toMatchObject({
    currentContributionAmount: "2.468",
    roundedUpRequiredVolume: "1.646",
  });
});
it.each(["UNKNOWN", "ESTIMATED"] as const)(
  "does not turn a %s cost into a margin recommendation",
  (quality) => {
    const input = fixture();
    const r = calculatePriceScenario({
      ...input,
      purchaseCost: { ...input.purchaseCost, quality },
    });
    expect(r).toMatchObject({
      status: "UNAVAILABLE",
      numbers: null,
      issues: [{ field: "purchaseCost", code: "COST_NOT_KNOWN" }],
    });
  },
);
it.each([
  "currentPrice",
  "proposedPrice",
  "purchaseCost",
  "currentVolume",
] as const)(
  "reports the exact missing input (%s) with no partial numbers",
  (field) => {
    const input = fixture();
    input[field].amount = null;
    expect(calculatePriceScenario(input)).toMatchObject({
      status: "UNAVAILABLE",
      numbers: null,
      issues: expect.arrayContaining([
        { field, code: "MISSING_AMOUNT", message: expect.any(String) },
      ]),
    });
  },
);
it("requires known compatible units and an explicit excluding-VAT basis, without tax or unit conversion", () => {
  const input = fixture();
  expect(
    calculatePriceScenario({
      ...input,
      purchaseCost: { ...input.purchaseCost, unit: "PIECE" },
    }),
  ).toMatchObject({
    status: "UNAVAILABLE",
    numbers: null,
    issues: expect.arrayContaining([
      {
        field: "purchaseCost",
        code: "INCOMPATIBLE_UNITS",
        message: expect.any(String),
      },
    ]),
  });
  for (const field of [
    "currentPrice",
    "proposedPrice",
    "purchaseCost",
    "currentVolume",
  ] as const) {
    const changed = JSON.parse(JSON.stringify(input)) as PriceScenarioInput;
    changed[field].unit = "UNKNOWN";
    expect(calculatePriceScenario(changed)).toMatchObject({
      status: "UNAVAILABLE",
      numbers: null,
      issues: expect.arrayContaining([
        { field, code: "UNKNOWN_UNIT", message: expect.any(String) },
      ]),
    });
  }
  for (const taxBasis of ["INCLUDING_VAT", "UNKNOWN"] as const) {
    const changed = {
      ...input,
      currentPrice: { ...input.currentPrice, taxBasis },
      proposedPrice: { ...input.proposedPrice, taxBasis },
      purchaseCost: { ...input.purchaseCost, taxBasis },
    };
    expect(calculatePriceScenario(changed)).toMatchObject({
      status: "UNAVAILABLE",
      numbers: null,
    });
    expect(calculatePriceScenario(changed).issues.map((i) => i.code)).toEqual(
      Array(3).fill("EXCLUDING_VAT_REQUIRED"),
    );
  }
});
it("blocks zero volume, fractional count quantities and zero/negative contributions", () => {
  const input = fixture();
  for (const field of ["currentPrice", "proposedPrice"] as const)
    for (const amount of ["1", "0.99"]) {
      const changed = JSON.parse(JSON.stringify(input)) as PriceScenarioInput;
      changed[field].amount = amount;
      expect(calculatePriceScenario(changed)).toMatchObject({
        status: "UNAVAILABLE",
        numbers: null,
        issues: expect.arrayContaining([
          {
            field,
            code:
              field === "currentPrice"
                ? "NON_POSITIVE_CURRENT_CONTRIBUTION"
                : "NON_POSITIVE_PROPOSED_CONTRIBUTION",
            message: expect.any(String),
          },
        ]),
      });
    }
  expect(
    calculatePriceScenario({
      ...input,
      currentVolume: { ...input.currentVolume, amount: "0" },
    }),
  ).toMatchObject({
    status: "UNAVAILABLE",
    numbers: null,
    issues: expect.arrayContaining([
      {
        field: "currentVolume",
        code: "NON_POSITIVE_CURRENT_VOLUME",
        message: expect.any(String),
      },
    ]),
  });
  for (const unit of ["PIECE", "PACK"] as const) {
    const changed = fixture(unit);
    changed.currentVolume.amount = "1.5";
    expect(calculatePriceScenario(changed)).toMatchObject({
      status: "UNAVAILABLE",
      numbers: null,
      issues: expect.arrayContaining([
        {
          field: "currentVolume",
          code: "FRACTIONAL_COUNT_VOLUME",
          message: expect.any(String),
        },
      ]),
    });
  }
});
it("rejects malformed, unbounded or injected assumptions instead of coercing them", () => {
  for (const amount of [
    "01",
    "-0",
    "-1",
    "1,5",
    "1e3",
    ".5",
    "1.",
    "Infinity",
    "NaN",
    "1000000000000",
    "1.0000001",
  ]) {
    const input = fixture();
    input.currentPrice.amount = amount;
    expect(() => calculatePriceScenario(input)).toThrow();
  }
  expect(
    priceScenarioInputSchema.safeParse({ ...fixture(), forecast: "20%" })
      .success,
  ).toBe(false);
  expect(
    priceScenarioInputSchema.safeParse({
      ...fixture(),
      purchaseCost: { ...fixture().purchaseCost, confirmedByAI: true },
    }).success,
  ).toBe(false);
  expect(
    priceScenarioInputSchema.safeParse({
      ...fixture(),
      currentVolume: { amount: 100, unit: "KG" },
    }).success,
  ).toBe(false);
  const unavailable = calculatePriceScenario({
    ...fixture(),
    purchaseCost: { ...fixture().purchaseCost, quality: "UNKNOWN" },
  });
  expect(
    priceScenarioResultSchema.safeParse({ ...unavailable, status: "AVAILABLE" })
      .success,
  ).toBe(false);
});
it("normalizes rounded negative zero without hiding a real negative volume change", () => {
  const input = fixture();
  input.currentPrice.amount = "2";
  input.purchaseCost.amount = "0";
  input.proposedPrice.amount = "2.000001";
  expect(
    calculatePriceScenario(input).numbers?.approximateVolumeChangePct,
  ).toBe("0.00");
});
it("uses exact ceilings at very large and near-integer boundaries", () => {
  const input = fixture("PIECE");
  input.currentPrice.amount = "999999999999.999999";
  input.proposedPrice.amount = "0.000002";
  input.purchaseCost.amount = "0.000001";
  input.currentVolume.amount = "999999999999";
  const r = calculatePriceScenario(input);
  expect(r.status).toBe("AVAILABLE");
  const n = r.numbers!;
  expect(
    new BusinessDecimal(n.roundedUpRequiredVolume)
      .times(n.proposedUnitContribution)
      .gte(n.currentContributionAmount),
  ).toBe(true);
  expect(
    new BusinessDecimal(n.roundedUpRequiredVolume)
      .minus(1)
      .times(n.proposedUnitContribution)
      .lt(n.currentContributionAmount),
  ).toBe(true);
  const near = fixture("PIECE");
  near.currentPrice.amount = "2.000001";
  near.proposedPrice.amount = "2";
  near.currentVolume.amount = "1000000";
  expect(calculatePriceScenario(near).numbers?.roundedUpRequiredVolume).toBe(
    "1000001",
  );
});
it("preserves the contribution target at the smallest declared output step across a deterministic scenario matrix", () => {
  for (const unit of ["KG", "PIECE", "PACK"] as const)
    for (const price of ["1.01", "2.49", "100.000001"])
      for (const cost of ["0", "0.99"])
        for (const proposed of ["1", "1.5", "19.99"])
          for (const volume of ["1", "17", "999"]) {
            const input = fixture(unit);
            input.currentPrice.amount = price;
            input.purchaseCost.amount = cost;
            input.proposedPrice.amount = proposed;
            input.currentVolume.amount = volume;
            const r = calculatePriceScenario(input);
            expect(r.status).toBe("AVAILABLE");
            const n = r.numbers!,
              minimum = new BusinessDecimal(n.roundedUpRequiredVolume),
              contribution = new BusinessDecimal(n.proposedUnitContribution),
              target = new BusinessDecimal(n.currentContributionAmount);
            expect(minimum.times(contribution).gte(target)).toBe(true);
            expect(
              minimum.minus(n.roundingIncrement).times(contribution).lt(target),
            ).toBe(true);
          }
});
