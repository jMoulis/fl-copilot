import { z } from "zod";

/** App-owned immutable source: ordered original views of ONE receipt. */
export const RECEIPT_PHOTO_BUNDLE_MIME =
  "application/vnd.flcopilot.receipt+json";
export const RECEIPT_PHOTO_BUNDLE_VERSION = "receipt-photo-bundle.v1";
export const MAX_RECEIPT_VIEWS = 5;
export const MAX_RECEIPT_VIEW_BYTES = 20 * 1024 * 1024;
export const MAX_RECEIPT_ORIGINAL_BYTES = 48 * 1024 * 1024;
export const MAX_RECEIPT_BUNDLE_BYTES = 65 * 1024 * 1024;

export const receiptPhotoViewSchema = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/heic", "image/heif"]),
    sizeBytes: z.number().int().positive().max(MAX_RECEIPT_VIEW_BYTES),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    dataBase64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_RECEIPT_VIEW_BYTES / 3))
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict()
  .superRefine((view, context) => {
    const padding = view.dataBase64.endsWith("==")
      ? 2
      : view.dataBase64.endsWith("=")
        ? 1
        : 0;
    if (
      view.dataBase64.length % 4 !== 0 ||
      (view.dataBase64.length / 4) * 3 - padding !== view.sizeBytes
    ) {
      context.addIssue({
        code: "custom",
        path: ["sizeBytes"],
        message: "Encoded size mismatch",
      });
    }
  });

export const receiptPhotoBundleSchema = z
  .object({
    schemaVersion: z.literal(RECEIPT_PHOTO_BUNDLE_VERSION),
    mode: z.literal("ONE_RECEIPT_MULTIPLE_PHOTOS"),
    views: z.array(receiptPhotoViewSchema).min(2).max(MAX_RECEIPT_VIEWS),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.views.reduce((total, view) => total + view.sizeBytes, 0) >
      MAX_RECEIPT_ORIGINAL_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["views"],
        message: "Original byte budget exceeded",
      });
    }
    if (
      new Set(bundle.views.map((view) => view.checksum)).size !==
      bundle.views.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["views"],
        message: "Repeated identical photo",
      });
    }
  });

export type ReceiptPhotoBundle = z.infer<typeof receiptPhotoBundleSchema>;

/** Excludes filenames, IDs and times so the same ordered bytes keep the same identity. */
export function serializeReceiptPhotoBundle(input: ReceiptPhotoBundle): string {
  const bundle = receiptPhotoBundleSchema.parse(input);
  return JSON.stringify({
    schemaVersion: bundle.schemaVersion,
    mode: bundle.mode,
    views: bundle.views.map((view) => ({
      mimeType: view.mimeType,
      sizeBytes: view.sizeBytes,
      checksum: view.checksum,
      dataBase64: view.dataBase64,
    })),
  });
}

/** These failures require corrected evidence/support, never an automatic analysis reset. */
export const receiptMultiViewBlockingCodes: readonly string[] = [
  "WASTE_RECEIPT_PHOTO_BUNDLE_INVALID",
  "WASTE_RECEIPT_MULTIVIEW_SOURCE_INVALID",
  "WASTE_RECEIPT_MULTIVIEW_MODEL_CHANGED",
  "WASTE_RECEIPT_MULTIVIEW_DERIVATIVE_INVALID",
  "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
  "WASTE_RECEIPT_MULTIVIEW_ATTEMPTS_EXHAUSTED",
];
