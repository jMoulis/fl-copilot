import { z } from "zod";
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
