import { z } from "zod";
import { MAX_MERCALYS_BATCH_BYTES } from "./mercalys-batch";
export const mercalysArchiveInputSchema = z.strictObject({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  filename: z.string().trim().min(1).max(240),
  localUri: z.string().max(2048).startsWith("file://"),
  sizeBytes: z.number().int().positive().max(MAX_MERCALYS_BATCH_BYTES),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
});
export const mercalysArchiveOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("RETAINED") }),
  z.strictObject({
    status: z.literal("FAILED"),
    code: z.string().min(1).max(120),
  }),
  z.strictObject({
    status: z.literal("PROCESSED"),
    retainedCount: z.number().int().nonnegative().max(100),
    failures: z
      .array(
        z.strictObject({
          path: z.string().min(1).max(240),
          code: z.string().min(1).max(120),
        }),
      )
      .max(100),
    ignored: z.array(z.string().min(1).max(240)).max(200),
  }),
]);
export const mercalysArchiveSchema = mercalysArchiveInputSchema.extend({
  version: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
  outcome: mercalysArchiveOutcomeSchema,
});
export type MercalysArchiveInput = z.infer<typeof mercalysArchiveInputSchema>;
export type MercalysArchiveOutcome = z.infer<
  typeof mercalysArchiveOutcomeSchema
>;
