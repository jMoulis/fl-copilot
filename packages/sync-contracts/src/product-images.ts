import { z } from "zod";
import { visualProvenanceSchema } from "@fl-copilot/domain";

export const productImageOptionsSchema = z.strictObject({
  available: z.boolean(),
  reasonFr: z.string().nullable(),
  model: z.string(),
  estimatedCostUsd: z.number().positive().nullable(),
  policyId: z.string(),
  productVersion: z.number().int().nonnegative(),
});
export const productImageRequestSchema = z.strictObject({
  requestId: z.uuid(),
  productId: z.uuid(),
  productVersion: z.number().int().nonnegative(),
  policyId: z.string().min(1).max(100),
});
export const generatedProductImageSchema = z.strictObject({
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.literal("image/png"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(12 * 1024 * 1024),
  width: z.literal(1024),
  height: z.literal(1024),
  provenance: visualProvenanceSchema.pipe(
    z.strictObject({
      type: z.literal("AI_GENERATED"),
      provider: z.string().trim().min(1),
      model: z.string().trim().min(1),
      promptVersion: z.string().trim().min(1),
    }),
  ),
});
export const productImageResultSchema = z
  .strictObject({
    requestId: z.uuid(),
    productId: z.uuid(),
    productVersion: z.number().int().nonnegative(),
    status: z.enum(["RUNNING", "READY", "UNKNOWN"]),
    image: generatedProductImageSchema.nullable(),
  })
  .refine(
    (v) => (v.status === "READY") === (v.image !== null),
    "Le résultat doit contenir une image uniquement lorsqu’il est prêt.",
  );
export type ProductImageOptions = z.infer<typeof productImageOptionsSchema>;
export type ProductImageRequest = z.infer<typeof productImageRequestSchema>;
export type ProductImageResult = z.infer<typeof productImageResultSchema>;
export type GeneratedProductImage = z.infer<typeof generatedProductImageSchema>;
