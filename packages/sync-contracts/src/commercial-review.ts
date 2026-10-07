import { z } from "zod";
import {
  commercialAiBlockSchema,
  commercialAiFieldSchema,
  commercialAiPageOutputSchema,
  commercialFieldNameSchema,
} from "@fl-copilot/domain";
export const commercialReviewPageSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  checksum: z.string().min(1),
  pageNumber: z.number().int().min(1).max(100),
  pageCount: z.number().int().min(1).max(100),
  originalFilename: z.string().nullable(),
  remoteVersion: z.literal(1),
  blocks: z
    .array(
      commercialAiBlockSchema.extend({
        sourceBlockIndex: z.number().int().nonnegative(),
        validationStatus: z.literal("TO_VALIDATE"),
        fields: z
          .array(
            commercialAiFieldSchema.extend({
              validationStatus: z.literal("TO_VALIDATE"),
            }),
          )
          .max(30),
      }),
    )
    .max(100),
  warnings: commercialAiPageOutputSchema.shape.warnings,
  issues: z
    .array(
      z.object({
        blockIndex: z.number().int().nonnegative(),
        fieldName: z.string().nullable(),
        code: z.enum([
          "UNSUPPORTED_BLOCK",
          "UNSUPPORTED_FIELD",
          "DUPLICATE_FIELD",
        ]),
      }),
    )
    .max(3100),
});
export const commercialReviewDecisionSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    pageId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    sourceBlockIndex: z.number().int().nonnegative(),
    checksum: z.string().min(1),
    decision: z.enum(["CONFIRMED_TRANSCRIPTION", "DISMISSED"]),
    corrections: z
      .array(
        z
          .object({
            name: commercialFieldNameSchema,
            value: z.string().trim().min(1).max(2000).nullable(),
          })
          .strict(),
      )
      .max(30),
    reviewedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.corrections.map((c) => c.name)).size !==
      value.corrections.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate corrections" });
    if (value.decision === "DISMISSED" && value.corrections.length)
      ctx.addIssue({
        code: "custom",
        message: "Dismissed transcription cannot contain corrections",
      });
  });
export const synchronizedCommercialReviewDecisionSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    remoteVersion: z.literal(1),
    decision: commercialReviewDecisionSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.id !== value.decision.id ||
      value.storeId !== value.decision.storeId
    )
      ctx.addIssue({ code: "custom", message: "Decision envelope mismatch" });
  });
export type CommercialReviewPage = z.infer<typeof commercialReviewPageSchema>;
export type CommercialReviewDecision = z.infer<
  typeof commercialReviewDecisionSchema
>;
export type SynchronizedCommercialReviewDecision = z.infer<
  typeof synchronizedCommercialReviewDecisionSchema
>;
