import { z } from "zod";
import { MAX_RECEIPT_VIEWS } from "./receipt-photo-bundle";
/** Device-only selection. Each selected photo is explicitly a separate receipt. */
export const MAX_COPILOT_RECEIPT_PHOTOS = 10;
export const MAX_COPILOT_RECEIPT_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_COPILOT_RECEIPT_BATCH_BYTES = 80 * 1024 * 1024;
export const copilotReceiptPhotoBatchSchema = z.strictObject({
  mode: z.literal("ONE_PHOTO_PER_RECEIPT"),
  assets: z
    .array(
      z.strictObject({
        uri: z.string().min(1).max(4096),
        filename: z.string().trim().min(1).max(240),
        mimeType: z
          .enum(["image/jpeg", "image/png", "image/heic", "image/heif"])
          .nullable(),
      }),
    )
    .min(1)
    .max(MAX_COPILOT_RECEIPT_PHOTOS),
});
export type CopilotReceiptPhotoBatch = z.infer<
  typeof copilotReceiptPhotoBatchSchema
>;

/** Explicitly ordered views of a single long receipt; consumes one chat slot. */
export const copilotReceiptViewsSelectionSchema = z.strictObject({
  mode: z.literal("ONE_RECEIPT_MULTIPLE_PHOTOS"),
  assets: z
    .array(copilotReceiptPhotoBatchSchema.shape.assets.element)
    .min(2)
    .max(MAX_RECEIPT_VIEWS),
});
export type CopilotReceiptViewsSelection = z.infer<
  typeof copilotReceiptViewsSelectionSchema
>;

/** One camera session is one receipt, regardless of the number of confirmed views. */
export const copilotReceiptCameraSelectionSchema = z.strictObject({
  mode: z.literal("ONE_RECEIPT_CAMERA"),
  assets: z
    .array(copilotReceiptPhotoBatchSchema.shape.assets.element)
    .min(1)
    .max(MAX_RECEIPT_VIEWS),
});
export type CopilotReceiptCameraSelection = z.infer<
  typeof copilotReceiptCameraSelectionSchema
>;
