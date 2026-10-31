import { z } from "zod";
import { copilotAnalysisPeriodSchema } from "./business-dates";
/** Logical, public read views over existing collections; never a collection name supplied unchecked. */
export const copilotMongoCollectionSchema = z.enum([
  "products",
  "productDailyPerformance",
  "departmentDailyPerformance",
]);
export const copilotMongoListInputSchema = z.strictObject({
  collection: copilotMongoCollectionSchema.nullable(),
  period: copilotAnalysisPeriodSchema.nullable(),
  afterId: z.string().min(1).max(200).nullable(),
  limit: z.number().int().min(1).max(20),
});
export const copilotMongoGetInputSchema = z.strictObject({
  collection: copilotMongoCollectionSchema,
  id: z.string().min(1).max(200),
});
export const copilotMongoAggregateInputSchema = z.strictObject({
  collection: copilotMongoCollectionSchema,
  period: copilotAnalysisPeriodSchema.nullable(),
  /** JSON preserves ordinary Mongo syntax without an unbounded provider-side JSON schema. */
  pipeline: z.string().min(2).max(12000),
});
export const copilotMongoReadInputSchema = z.discriminatedUnion("action", [
  copilotMongoListInputSchema.extend({ action: z.literal("LIST") }),
  copilotMongoGetInputSchema.extend({ action: z.literal("GET") }),
  copilotMongoAggregateInputSchema.extend({ action: z.literal("AGGREGATE") }),
]);
export type CopilotMongoReadInput = z.infer<typeof copilotMongoReadInputSchema>;
