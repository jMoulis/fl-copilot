import { z } from "zod";

const confidenceSchema = z
  .object({
    label: z.number().min(0).max(1),
    quantity: z.number().min(0).max(1),
    unitPrice: z.number().min(0).max(1),
    totalPrice: z.number().min(0).max(1),
  })
  .strict();

export const sourceRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .strict();

export const wasteReceiptVisionOutputSchema = z
  .object({
    detectedReceiptDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    cashierNumber: z.string().min(1).max(64).nullable(),
    cashierNumberConfidence: z.number().min(0).max(1).nullable(),
    cashierNumberRegion: sourceRegionSchema.nullable(),
    lines: z
      .array(
        z
          .object({
            sourceLineIndex: z.number().int().nonnegative(),
            rawLabel: z.string().trim().min(1).max(240),
            quantity: z.number().nonnegative().nullable(),
            weight: z.number().nonnegative().nullable(),
            quantityUnit: z.string().trim().min(1).max(32).nullable(),
            unitPrice: z.number().nonnegative().nullable(),
            totalPrice: z.number().nonnegative().nullable(),
            extractionConfidence: confidenceSchema,
            sourceRegion: sourceRegionSchema.nullable(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export type WasteReceiptVisionOutput = z.infer<
  typeof wasteReceiptVisionOutputSchema
>;

export const wasteReceiptMultiViewVisionOutputSchema =
  wasteReceiptVisionOutputSchema
    .extend({
      singleReceipt: z.boolean(),
      overlapResolved: z.boolean(),
      cashierImageIndex: z.number().int().min(0).max(4).nullable(),
      lines: z
        .array(
          wasteReceiptVisionOutputSchema.shape.lines.element
            .extend({
              sourceImageIndexes: z
                .array(z.number().int().min(0).max(4))
                .min(1)
                .max(5),
            })
            .strict(),
        )
        .max(500),
    })
    .strict();
export type WasteReceiptMultiViewVisionOutput = z.infer<
  typeof wasteReceiptMultiViewVisionOutputSchema
>;
