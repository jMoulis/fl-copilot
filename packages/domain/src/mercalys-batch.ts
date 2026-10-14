import { z } from "zod";
export const MAX_MERCALYS_BATCH_FILES = 100;
export const MAX_MERCALYS_BATCH_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_MERCALYS_BATCH_BYTES = 100 * 1024 * 1024;
const uuid = z.string().uuid();
export const retainedMercalysBatchFileSchema = z.strictObject({
  id: uuid,
  filename: z.string().trim().min(1).max(240),
  localUri: z.string().min(1).max(2048).startsWith("file://"),
  sizeBytes: z.number().int().positive().max(MAX_MERCALYS_BATCH_FILE_BYTES),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Trusted native intake metadata, never a model-granted publication request. */
export const mercalysBatchInputSchema = z
  .strictObject({
    id: uuid,
    storeId: uuid,
    ownerId: uuid,
    conversationId: uuid.nullable(),
    archiveId: uuid.optional(),
    createdAt: z.string().datetime({ offset: true }),
    files: z
      .array(retainedMercalysBatchFileSchema)
      .min(1)
      .max(MAX_MERCALYS_BATCH_FILES),
  })
  .superRefine((batch, ctx) => {
    if (new Set(batch.files.map((f) => f.id)).size !== batch.files.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate intake item ID",
        path: ["files"],
      });
    if (
      batch.files.reduce((sum, f) => sum + f.sizeBytes, 0) >
      MAX_MERCALYS_BATCH_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Batch byte limit exceeded",
        path: ["files"],
      });
  });
export const mercalysBatchResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("QUEUED") }),
  z.strictObject({
    status: z.literal("FAILED"),
    code: z.string().min(1).max(120),
  }),
  z.strictObject({
    status: z.literal("DUPLICATE"),
    sourceDocumentId: uuid,
    sourceType: z.enum(["MERCALYS_SALES", "MERCALYS_WASTE"]),
  }),
  z.strictObject({
    status: z.literal("REVIEW"),
    sourceType: z.enum(["MERCALYS_SALES", "MERCALYS_WASTE"]),
    parserVersion: z.string().min(1).max(120),
    businessPeriodStart: z.string().date(),
    businessPeriodEnd: z.string().date(),
    readyCount: z.number().int().nonnegative(),
    productReviewCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    overlap: z.boolean(),
  }),
]);
export const mercalysBatchItemSchema = retainedMercalysBatchFileSchema.extend({
  batchId: uuid,
  position: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_MERCALYS_BATCH_FILES - 1),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
  result: mercalysBatchResultSchema,
});
export type MercalysBatchInput = z.infer<typeof mercalysBatchInputSchema>;
export type MercalysBatchItem = z.infer<typeof mercalysBatchItemSchema>;
export type MercalysBatchResult = z.infer<typeof mercalysBatchResultSchema>;
