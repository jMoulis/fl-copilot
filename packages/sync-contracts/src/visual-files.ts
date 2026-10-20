import { z } from "zod";
import { VISUAL_LIBRARY_POLICY, type VisualAsset } from "@fl-copilot/domain";
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dimensions = {
  width: z.number().int().positive().max(12000),
  height: z.number().int().positive().max(12000),
};
export const visualFileManifestSchema = z.strictObject({
  assetId: z.uuid(),
  storeId: z.uuid(),
  processorVersion: z.literal("visual-image.v1"),
  source: z.strictObject({
    contentHash: hash,
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(VISUAL_LIBRARY_POLICY.maximumBytes),
    ...dimensions,
  }),
  preview: z.strictObject({
    contentHash: hash,
    mimeType: z.literal("image/jpeg"),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024),
    width: z.number().int().positive().max(1024),
    height: z.number().int().positive().max(1024),
  }),
});
export type VisualFileManifest = z.infer<typeof visualFileManifestSchema>;
export const initVisualFileRequestSchema = z.strictObject({
  assetId: z.uuid(),
});
export const initVisualFileResponseSchema = z
  .strictObject({
    state: z.enum(["READY", "UPLOAD_REQUIRED"]),
    uploadId: z.uuid().nullable(),
    uploadUrl: z.url({ protocol: /^https$/ }).nullable(),
    expiresAt: z.iso.datetime().nullable(),
    headers: z.record(z.string(), z.string()),
    manifest: visualFileManifestSchema.nullable(),
  })
  .refine(
    (v) =>
      v.state === "READY"
        ? !!v.manifest && !v.uploadId && !v.uploadUrl && !v.expiresAt
        : !!v.uploadId && !!v.uploadUrl && !!v.expiresAt && !v.manifest,
    "Réponse d’envoi incohérente.",
  );
export type InitVisualFileResponse = z.infer<
  typeof initVisualFileResponseSchema
>;
export const completeVisualFileRequestSchema = z.strictObject({
  assetId: z.uuid(),
  uploadId: z.uuid(),
});

/** Bind a server file proof to immutable metadata on every read, not just at upload. */
export function readVisualFileManifest(
  raw: unknown,
  asset: VisualAsset,
): VisualFileManifest {
  const value = visualFileManifestSchema.parse(raw);
  if (
    value.assetId !== asset.id ||
    value.storeId !== asset.storeId ||
    value.source.contentHash !== asset.contentHash ||
    value.source.mimeType !== asset.mimeType ||
    value.source.sizeBytes !== asset.sizeBytes ||
    value.source.width !== asset.width ||
    value.source.height !== asset.height
  )
    throw Error("VISUAL_FILE_BINDING_INVALID");
  return value;
}
