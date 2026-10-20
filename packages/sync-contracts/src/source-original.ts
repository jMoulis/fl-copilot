import { z } from "zod";
import {
  MAX_RECEIPT_BUNDLE_BYTES,
  MAX_STORE_PHOTO_BYTES,
  RECEIPT_PHOTO_BUNDLE_MIME,
  storePhotoMimeSchema,
} from "@fl-copilot/domain";
import {
  uploadSourceTypeSchema,
  sourceUploadChecksumSchema,
  sourceUploadMimeTypeSchema,
} from "./uploads";

/** Immutable original metadata. No business date, publication state, URI or storage path. */
export const sourceOriginalMetadataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceDocumentId: z.uuid(),
    storeId: z.uuid(),
    access: z.enum(["STORE", "OWNER"]),
    ownerId: z.uuid().nullable(),
    sourceType: uploadSourceTypeSchema,
    filename: z.string().min(1).max(255),
    mimeType: sourceUploadMimeTypeSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    checksum: sourceUploadChecksumSchema,
    registeredAt: z.iso.datetime(),
    objectVersion: z.string().min(1).max(512).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.sourceType === "STORE_PHOTO"
        ? value.access !== "OWNER" || value.ownerId === null
        : value.access !== "STORE" || value.ownerId !== null
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid original visibility",
        path: ["access"],
      });
    const image = storePhotoMimeSchema.safeParse(value.mimeType).success;
    const valid =
      value.sourceType === "WEEKLY_COMMERCIAL_PDF"
        ? value.mimeType === "application/pdf"
        : value.sourceType === "MERCALYS_SALES" ||
            value.sourceType === "MERCALYS_WASTE"
          ? value.mimeType ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : value.sourceType === "STORE_PHOTO"
            ? image &&
              value.sizeBytes <= MAX_STORE_PHOTO_BYTES &&
              value.filename.length <= 240
            : image ||
              (value.mimeType === RECEIPT_PHOTO_BUNDLE_MIME &&
                value.sizeBytes <= MAX_RECEIPT_BUNDLE_BYTES);
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Invalid original source format",
        path: ["mimeType"],
      });
  });
export const sourceOriginalManifestSchema =
  sourceOriginalMetadataSchema.safeExtend({
    manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  });
/** A transport capability, never conversation content or a persisted transfer target. */
export const sourceOriginalDownloadSchema = z.strictObject({
  manifest: sourceOriginalManifestSchema,
  url: z
    .string()
    .url()
    .regex(
      /^https:\/\/[a-zA-Z0-9-]+\.private\.blob\.vercel-storage\.com(?::443)?\/[^#\r\n\0]*$/,
      "Invalid private original download URL",
    ),
  expiresAt: z.iso.datetime(),
});
export function serializeSourceOriginalMetadata(raw: unknown) {
  return JSON.stringify(sourceOriginalMetadataSchema.parse(raw));
}
export type SourceOriginalMetadata = z.infer<
  typeof sourceOriginalMetadataSchema
>;
export type SourceOriginalManifest = z.infer<
  typeof sourceOriginalManifestSchema
>;
export type SourceOriginalDownload = z.infer<
  typeof sourceOriginalDownloadSchema
>;
