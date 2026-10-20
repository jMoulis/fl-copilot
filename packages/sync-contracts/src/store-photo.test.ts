import { expect, it } from "vitest";
import { initSourceUploadRequestSchema } from "./uploads";
import {
  MAX_STORE_PHOTO_BYTES,
  RECEIPT_PHOTO_BUNDLE_MIME,
  storePhotoReadInputSchema,
} from "@fl-copilot/domain";
const input = {
  sourceDocumentId: "00000000-0000-4000-8000-000000000001",
  sourceType: "STORE_PHOTO",
  filename: "rayon.png",
  mimeType: "image/png",
  checksum: `sha256:${"a".repeat(64)}`,
  sizeBytes: 2048,
};
it("accepts explicit image sources without accepting receipt bundles, spreadsheets or oversized photos", () => {
  for (const mimeType of [
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/heif",
  ])
    expect(
      initSourceUploadRequestSchema.safeParse({ ...input, mimeType }).success,
    ).toBe(true);
  for (const patch of [
    { mimeType: RECEIPT_PHOTO_BUNDLE_MIME },
    { mimeType: "application/pdf" },
    {
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { sizeBytes: MAX_STORE_PHOTO_BYTES + 1 },
    { filename: "x".repeat(241) },
  ])
    expect(
      initSourceUploadRequestSchema.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
});
it("never accepts model-supplied scope, private URL or object key", () => {
  expect(
    storePhotoReadInputSchema.parse({
      sourceDocumentId: input.sourceDocumentId,
    }),
  ).toEqual({ sourceDocumentId: input.sourceDocumentId });
  for (const field of ["storeId", "ownerId", "objectKey", "url"])
    expect(
      storePhotoReadInputSchema.safeParse({
        sourceDocumentId: input.sourceDocumentId,
        [field]: "untrusted",
      }).success,
    ).toBe(false);
});
