import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";

export const MAX_STORE_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_STORE_PHOTO_PIXELS = 36_000_000;
export const MAX_STORE_PHOTOS_PER_TURN = 3;
export const MAX_STORE_PHOTO_FRAME_BYTES = 2 * 1024 * 1024;
export const storePhotoMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
export const storePhotoReadInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
});
export const storePhotoSnapshotSchema = z
  .strictObject({
    source: z.strictObject({
      sourceDocumentId: z.uuid(),
      sourceType: z.literal("STORE_PHOTO"),
      filename: z.string().min(1).max(240),
      checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      registeredAt: z.iso.datetime(),
    }),
    frame: z.strictObject({
      checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      mimeType: z.literal("image/jpeg"),
      width: z.number().int().min(1).max(2048),
      height: z.number().int().min(1).max(2048),
      sizeBytes: z.number().int().min(1).max(MAX_STORE_PHOTO_FRAME_BYTES),
    }),
    status: z.literal("AVAILABLE"),
    evidence: z.array(copilotEvidenceSchema).length(1),
  })
  .superRefine((value, ctx) => {
    const e = value.evidence[0]!;
    if (
      e.sourceId !== value.source.sourceDocumentId ||
      e.sourceType !== "SOURCE_DOCUMENT" ||
      e.factKind !== "QUALITY" ||
      e.sourceVersion !== null ||
      e.id !==
        `store-photo/${value.source.sourceDocumentId}/${value.source.checksum.slice(7)}`
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid store photo source evidence",
      });
  });
export type StorePhotoSnapshot = z.infer<typeof storePhotoSnapshotSchema>;

export const storePhotoSelectionSchema = z.strictObject({
  assets: z
    .array(
      z.strictObject({
        uri: z.string().min(1).max(4096),
        filename: z.string().min(1).max(240),
        mimeType: storePhotoMimeSchema,
      }),
    )
    .min(1)
    .max(MAX_STORE_PHOTOS_PER_TURN),
});
export type StorePhotoSelection = z.infer<typeof storePhotoSelectionSchema>;
