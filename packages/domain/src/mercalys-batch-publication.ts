import { z } from "zod";
import { MAX_MERCALYS_BATCH_FILES } from "./mercalys-batch";
/** Native reviewed plan. Display metadata alone never grants publication authority. */
export const mercalysBatchPublicationPlanSchema = z.strictObject({
  batchId: z.string().uuid(),
  items: z
    .array(
      z.strictObject({
        itemId: z.string().uuid(),
        filename: z.string().min(1).max(240),
        status: z.enum(["READY", "DUPLICATE", "BLOCKED", "FAILED"]),
        readyCount: z.number().int().nonnegative(),
        remainingCount: z.number().int().nonnegative(),
        code: z.string().min(1).max(120).optional(),
      }),
    )
    .min(1)
    .max(MAX_MERCALYS_BATCH_FILES),
});
export type MercalysBatchPublicationPlan = z.infer<
  typeof mercalysBatchPublicationPlanSchema
>;
