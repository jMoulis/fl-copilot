import { z } from "zod";
import { productCategorySchema, productNatureSchema } from "./products";
import {
  copilotBusinessDateSchema,
  copilotAnalysisPeriodSchema,
} from "./business-dates";
const year = z.number().int().min(1900).max(2199);
/** Serializable UI selection only; no alternative business datastore. */
export const analyticsExplorerPeriodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("day"), date: copilotBusinessDateSchema }),
  z.strictObject({
    kind: z.literal("week"),
    year,
    week: z.number().int().min(1).max(53),
  }),
  z.strictObject({
    kind: z.literal("month"),
    year,
    month: z.number().int().min(1).max(12),
  }),
  z.strictObject({ kind: z.literal("year"), year }),
  z.strictObject({
    kind: z.literal("range"),
    current: copilotAnalysisPeriodSchema,
    reference: copilotAnalysisPeriodSchema.nullable(),
    universe: copilotAnalysisPeriodSchema.optional(),
    aggregation: z.enum(["SUM", "AVERAGE"]),
    basis: z.enum(["DEPARTMENT", "OBSERVED_PRODUCTS"]),
  }),
]);
export type AnalyticsExplorerPeriod = z.infer<
  typeof analyticsExplorerPeriodSchema
>;
export const analyticsExplorerMetricSchema = z.enum([
  "sales",
  "margin",
  "waste",
  "wasteCost",
]);
export type AnalyticsExplorerMetric = z.infer<
  typeof analyticsExplorerMetricSchema
>;

/** Presentation filters; classification is the current catalogue, not historical inference. */
export const analyticsExplorerFiltersSchema = z.strictObject({
  category: productCategorySchema.nullable().default(null),
  nature: productNatureSchema.nullable().default(null),
  productId: z.uuid().nullable().default(null),
  productIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .nullable()
    .optional(),
  labelContains: z.string().trim().min(1).max(100).nullable().optional(),
});
export type AnalyticsExplorerFilters = z.infer<
  typeof analyticsExplorerFiltersSchema
>;
export const emptyExplorerFilters = (): AnalyticsExplorerFilters => ({
  category: null,
  nature: null,
  productId: null,
});

export type AnalyticsExplorerGranularity = Exclude<
  AnalyticsExplorerPeriod["kind"],
  "range"
>;
/** Server-created read-only destination. No tenant, URL, database operator or mutation. */
export const analyticsExplorerContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    relation: z.enum(["MONETARY", "RELATED_AMOUNTS"]).optional(),
    period: analyticsExplorerPeriodSchema,
    metric: analyticsExplorerMetricSchema,
    filters: analyticsExplorerFiltersSchema,
  })
  .refine(
    (ctx) =>
      ctx.period.kind !== "range" ||
      !ctx.period.universe ||
      (ctx.period.reference === null &&
        ctx.period.current.start >= ctx.period.universe.start &&
        ctx.period.current.end <= ctx.period.universe.end),
  );
export type AnalyticsExplorerContext = z.infer<
  typeof analyticsExplorerContextSchema
>;
