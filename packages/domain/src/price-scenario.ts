import { z } from "zod";
import { salesUnitSchema } from "./products";
/** Bounded canonical decimals only. UI adapters own French-number parsing. */
const inputDecimal = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/);
const outputDecimal = z
  .string()
  .max(100)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonNegativeOutput = outputDecimal.refine((s) => !s.startsWith("-"));
const positiveOutput = nonNegativeOutput.refine((s) => !/^0(?:\.0+)?$/.test(s));
const quote = z.strictObject({
  amount: inputDecimal.nullable(),
  unit: salesUnitSchema,
  currency: z.literal("EUR"),
  taxBasis: z.enum(["EXCLUDING_VAT", "INCLUDING_VAT", "UNKNOWN"]),
});
export const priceScenarioInputSchema = z.strictObject({
  currentPrice: quote,
  proposedPrice: quote,
  purchaseCost: quote.extend({
    quality: z.enum(["KNOWN", "ESTIMATED", "UNKNOWN"]),
  }),
  currentVolume: z.strictObject({
    amount: inputDecimal.nullable(),
    unit: salesUnitSchema,
  }),
});
export type PriceScenarioInput = z.infer<typeof priceScenarioInputSchema>;
export const priceScenarioIssueSchema = z.strictObject({
  field: z.enum([
    "currentPrice",
    "proposedPrice",
    "purchaseCost",
    "currentVolume",
  ]),
  code: z.enum([
    "MISSING_AMOUNT",
    "COST_NOT_KNOWN",
    "UNKNOWN_UNIT",
    "INCOMPATIBLE_UNITS",
    "EXCLUDING_VAT_REQUIRED",
    "NON_POSITIVE_CURRENT_VOLUME",
    "FRACTIONAL_COUNT_VOLUME",
    "NON_POSITIVE_CURRENT_CONTRIBUTION",
    "NON_POSITIVE_PROPOSED_CONTRIBUTION",
  ]),
  message: z.string().min(1),
});
const numbers = z
  .strictObject({
    unit: z.enum(["KG", "PIECE", "PACK"]),
    currentUnitContribution: positiveOutput,
    proposedUnitContribution: positiveOutput,
    currentContributionAmount: positiveOutput,
    approximateRequiredVolume: nonNegativeOutput,
    approximateVolumeChangePct: outputDecimal,
    roundedUpRequiredVolume: positiveOutput,
    roundedUpVolumeChangePct: outputDecimal,
    roundingIncrement: z.enum(["0.001", "1"]),
    approximateVolumeScale: z.literal(6),
    percentageScale: z.literal(2),
  })
  .refine((n) => n.roundingIncrement === (n.unit === "KG" ? "0.001" : "1"));
const common = {
  engineVersion: z.literal("price-scenario.v1"),
  kind: z.literal("THEORETICAL_CONTRIBUTION_THRESHOLD"),
  isDemandForecast: z.literal(false),
  assumptions: priceScenarioInputSchema,
  label: z.literal("Contribution théorique hors TVA"),
  warning: z.literal("Ce seuil n’est pas une prévision de demande."),
};
export const priceScenarioResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...common,
    status: z.literal("AVAILABLE"),
    issues: z.tuple([]),
    numbers,
  }),
  z.strictObject({
    ...common,
    status: z.literal("UNAVAILABLE"),
    issues: z.array(priceScenarioIssueSchema).min(1),
    numbers: z.null(),
  }),
]);
export type PriceScenarioResult = z.infer<typeof priceScenarioResultSchema>;
