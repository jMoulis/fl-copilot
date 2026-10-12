import { z } from "zod";
import { wasteReceiptSchema, wasteLineSchema } from "./waste-receipts";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { commercialValidatedOfferSchema } from "./commercial-validated-offer";
export const copilotBusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const dailyReadInputSchema = z.strictObject({
  businessDate: copilotBusinessDateSchema,
});
export const wasteReadInputSchema = z.strictObject({
  receiptId: z.string().uuid(),
});
export const offersReadInputSchema = z
  .strictObject({
    start: copilotBusinessDateSchema,
    end: copilotBusinessDateSchema,
    afterId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(25).default(25),
  })
  .refine(
    (v) =>
      v.start <= v.end &&
      (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 365,
  );
const base = {
  schemaVersion: z.literal(1),
  operationId: z.string().uuid(),
  status: z.literal("COMPLETED"),
  message: z.string(),
  observedAt: z.string().datetime(),
};
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .nullable();
const availability = z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]);
const period = z
  .strictObject({
    start: copilotBusinessDateSchema,
    end: copilotBusinessDateSchema,
  })
  .nullable();
const comparison = z.object({
  kpiId: z.string(),
  currentValue: decimal,
  referenceValue: decimal,
  absoluteDifference: decimal,
  percentageDifference: decimal,
  referenceMode: z.literal("J_MINUS_7"),
  referenceMethod: z.string(),
  currentPeriod: period,
  referencePeriod: period,
  currentSampleSize: z.number().int().nonnegative(),
  referenceSampleSize: z.number().int().nonnegative(),
  status: availability,
  qualityScore: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  sourceLineageIds: z.array(z.string()),
});
export const dailyReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("analytics.daily"),
  requestedDate: copilotBusinessDateSchema,
  snapshot: z
    .strictObject({
      businessDate: copilotBusinessDateSchema,
      computedAt: z.string().datetime(),
      origin: z.enum(["LOCAL", "REMOTE"]),
      productCount: z.number().int().nonnegative(),
      kpis: z.array(
        z.strictObject({
          id: z.enum(["sales", "margin", "waste"]),
          label: z.string(),
          value: decimal,
          status: availability,
          comparison,
        }),
      ),
      dataQuality: z.strictObject({
        unresolvedProductCount: z.number().int().nonnegative(),
        incompleteKpiLabels: z.array(z.string()),
        alertMessage: z.string().nullable(),
      }),
    })
    .nullable(),
});
export const wasteReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("waste.inspect"),
  snapshot: z
    .strictObject({
      receipt: wasteReceiptSchema,
      lines: z.array(wasteLineSchema).max(500),
    })
    .nullable(),
});
export const offersReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("commercial.offers"),
  start: copilotBusinessDateSchema,
  end: copilotBusinessDateSchema,
  offers: z
    .array(
      z.strictObject({
        choice: commercialOfferChoiceSchema,
        syncState: z.string(),
        validation: commercialValidatedOfferSchema.nullable(),
      }),
    )
    .max(25),
  hasMore: z.boolean(),
  nextAfterId: z.string().uuid().nullable(),
});
export const copilotContextRequestSchemas = [
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("analytics.daily"),
    input: dailyReadInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("waste.inspect"),
    input: wasteReadInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("commercial.offers"),
    input: offersReadInputSchema,
  }),
] as const;
export const copilotContextToolRegistry = [
  {
    name: "analytics.daily",
    inputSchema: dailyReadInputSchema,
    outputSchema: dailyReadResultSchema,
    description:
      "Consulter les chiffres d’un jour et la comparaison J−7, avec couverture et sources.",
    progress: "Lecture des chiffres…",
  },
  {
    name: "waste.inspect",
    inputSchema: wasteReadInputSchema,
    outputSchema: wasteReadResultSchema,
    description:
      "Consulter un ticket de casse et ses lignes, sans les publier ni les assimiler à des ventes.",
    progress: "Lecture de la casse…",
  },
  {
    name: "commercial.offers",
    inputSchema: offersReadInputSchema,
    outputSchema: offersReadResultSchema,
    description:
      "Consulter les offres retenues couvrant une période, leur validation et leur source originale.",
    progress: "Lecture des offres…",
  },
].map((t) => ({
  ...t,
  schemaVersion: 1 as const,
  effect: "READ" as const,
  runtime: "LOCAL" as const,
  confirmation: "NONE" as const,
}));

export const productChangesReadInputSchema = dailyReadInputSchema.extend({
  metric: z.enum(["sales", "margin"]),
  direction: z.enum(["INCREASE", "DECREASE"]),
});

export const copilotAnalysisPeriodSchema = z
  .strictObject({
    start: copilotBusinessDateSchema,
    end: copilotBusinessDateSchema,
  })
  .refine(
    (p) =>
      p.start <= p.end &&
      (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 3660,
    "Période invalide ou trop longue.",
  );
export const periodAnalysisInputSchema = z
  .strictObject({
    productId: z.string().uuid().nullable(),
    currentPeriod: copilotAnalysisPeriodSchema,
    referencePeriod: copilotAnalysisPeriodSchema.nullable(),
    aggregation: z.enum(["SUM", "AVERAGE"]),
    metrics: z
      .array(z.enum(["sales", "margin", "waste"]))
      .min(1)
      .max(3),
  })
  .refine(
    (v) => new Set(v.metrics).size === v.metrics.length,
    "Indicateurs dupliqués.",
  );
