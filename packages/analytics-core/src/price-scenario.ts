import {
  priceScenarioInputSchema,
  priceScenarioResultSchema,
  type PriceScenarioInput,
  type PriceScenarioResult,
  type priceScenarioIssueSchema,
} from "@fl-copilot/domain";
import type { z } from "zod";
import {
  BusinessDecimal,
  parseDecimal,
  serializeDecimal,
  subtractDecimals,
  multiplyDecimals,
} from "./decimal";
export const PRICE_SCENARIO_ENGINE_VERSION = "price-scenario.v1";
/** Pure calculator: callers must resolve and qualify assumptions; no observed KPI or write authority. */
export function calculatePriceScenario(
  raw: PriceScenarioInput,
): PriceScenarioResult {
  const input = priceScenarioInputSchema.parse(raw);
  const issues: Array<z.infer<typeof priceScenarioIssueSchema>> = [];
  const add = (
    field: z.infer<typeof priceScenarioIssueSchema>["field"],
    code: z.infer<typeof priceScenarioIssueSchema>["code"],
    message: string,
  ) => issues.push({ field, code, message });
  const entries = [
    "currentPrice",
    "proposedPrice",
    "purchaseCost",
    "currentVolume",
  ] as const;
  for (const field of entries) {
    const value = input[field];
    if (value.amount === null)
      add(
        field,
        "MISSING_AMOUNT",
        field === "purchaseCost"
          ? "Renseignez le coût d’achat unitaire connu."
          : field === "currentVolume"
            ? "Renseignez le volume actuel de référence."
            : field === "currentPrice"
              ? "Renseignez le prix de vente actuel."
              : "Renseignez le prix proposé.",
      );
    if (value.unit === "UNKNOWN")
      add(
        field,
        "UNKNOWN_UNIT",
        "Précisez l’unité : kg, pièce ou unité conditionnée.",
      );
    if (field !== "currentVolume" && input[field].taxBasis !== "EXCLUDING_VAT")
      add(
        field,
        "EXCLUDING_VAT_REQUIRED",
        "Le prix et le coût doivent être exprimés hors TVA, sans conversion supposée.",
      );
  }
  if (input.purchaseCost.quality !== "KNOWN")
    add(
      "purchaseCost",
      "COST_NOT_KNOWN",
      "Un coût estimé ou inconnu ne permet pas ce calcul de contribution.",
    );
  const knownUnits = entries.filter((f) => input[f].unit !== "UNKNOWN");
  const base = input.currentVolume.unit;
  if (base !== "UNKNOWN")
    for (const f of knownUnits)
      if (input[f].unit !== base)
        add(
          f,
          "INCOMPATIBLE_UNITS",
          "Utilisez la même unité pour les deux prix, le coût et le volume, sans conversion implicite.",
        );
  if (input.currentVolume.amount !== null) {
    const volume = parseDecimal(input.currentVolume.amount).value;
    if (volume.lte(0))
      add(
        "currentVolume",
        "NON_POSITIVE_CURRENT_VOLUME",
        "Le volume de référence doit être strictement positif.",
      );
    if (
      ["PIECE", "PACK"].includes(input.currentVolume.unit) &&
      !volume.isInteger()
    )
      add(
        "currentVolume",
        "FRACTIONAL_COUNT_VOLUME",
        "Un volume en pièces ou unités conditionnées doit être entier.",
      );
  }
  if (
    input.purchaseCost.amount !== null &&
    input.purchaseCost.quality === "KNOWN"
  ) {
    const cost = parseDecimal(input.purchaseCost.amount).value;
    if (
      input.currentPrice.amount !== null &&
      parseDecimal(input.currentPrice.amount).value.lte(cost)
    )
      add(
        "currentPrice",
        "NON_POSITIVE_CURRENT_CONTRIBUTION",
        "La contribution actuelle doit être positive pour définir ce seuil de maintien.",
      );
    if (
      input.proposedPrice.amount !== null &&
      parseDecimal(input.proposedPrice.amount).value.lte(cost)
    )
      add(
        "proposedPrice",
        "NON_POSITIVE_PROPOSED_CONTRIBUTION",
        "Le prix proposé doit dépasser le coût unitaire pour calculer ce seuil.",
      );
  }
  const common = {
    engineVersion: PRICE_SCENARIO_ENGINE_VERSION,
    kind: "THEORETICAL_CONTRIBUTION_THRESHOLD" as const,
    isDemandForecast: false as const,
    assumptions: input,
    label: "Contribution théorique hors TVA" as const,
    warning: "Ce seuil n’est pas une prévision de demande." as const,
  };
  if (issues.length)
    return priceScenarioResultSchema.parse({
      ...common,
      status: "UNAVAILABLE",
      issues,
      numbers: null,
    });
  const unit = input.currentVolume.unit as "KG" | "PIECE" | "PACK";
  const currentUnitContribution = subtractDecimals(
    input.currentPrice.amount!,
    input.purchaseCost.amount!,
  );
  const proposedUnitContribution = subtractDecimals(
    input.proposedPrice.amount!,
    input.purchaseCost.amount!,
  );
  const currentContributionAmount = multiplyDecimals(
    currentUnitContribution,
    input.currentVolume.amount!,
  );
  const volume = parseDecimal(input.currentVolume.amount!).value;
  const theoretical = parseDecimal(currentContributionAmount).value.div(
    parseDecimal(proposedUnitContribution).value,
  );
  const roundingIncrement = unit === "KG" ? "0.001" : "1";
  // Exact integer ceiling avoids rounding a near-boundary quotient down before the output-step ceiling.
  const steps = ceilDecimalRatio(
    currentContributionAmount,
    multiplyDecimals(proposedUnitContribution, roundingIncrement),
  );
  const minimum = new BusinessDecimal(steps.toString()).times(
    roundingIncrement,
  );
  const change = (v: InstanceType<typeof BusinessDecimal>) =>
    serializeDecimal(
      v.minus(volume).div(volume).times(100).toDecimalPlaces(2).plus(0),
      2,
    );
  const canonical = (v: string) => parseDecimal(v).value.toFixed();
  return priceScenarioResultSchema.parse({
    ...common,
    status: "AVAILABLE",
    issues: [],
    numbers: {
      unit,
      currentUnitContribution: canonical(currentUnitContribution),
      proposedUnitContribution: canonical(proposedUnitContribution),
      currentContributionAmount: canonical(currentContributionAmount),
      approximateRequiredVolume: serializeDecimal(theoretical, 6),
      approximateVolumeChangePct: change(theoretical),
      roundedUpRequiredVolume: serializeDecimal(minimum, unit === "KG" ? 3 : 0),
      roundedUpVolumeChangePct: change(minimum),
      roundingIncrement,
      approximateVolumeScale: 6,
      percentageScale: 2,
    },
  });
}
function ceilDecimalRatio(numerator: string, denominator: string): bigint {
  const fraction = (s: string) => {
    const [whole, part = ""] = s.split(".");
    return { n: BigInt(whole! + part), d: 10n ** BigInt(part.length) };
  };
  const n = fraction(numerator),
    d = fraction(denominator);
  const top = n.n * d.d,
    bottom = d.n * n.d;
  return (top + bottom - 1n) / bottom;
}
