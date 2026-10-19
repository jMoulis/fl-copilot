import { z } from "zod";
import { copilotBusinessDateSchema } from "./copilot-context-tools";
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
]);
export type AnalyticsExplorerPeriod = z.infer<
  typeof analyticsExplorerPeriodSchema
>;
export const analyticsExplorerMetricSchema = z.enum([
  "sales",
  "margin",
  "waste",
]);
export type AnalyticsExplorerMetric = z.infer<
  typeof analyticsExplorerMetricSchema
>;
