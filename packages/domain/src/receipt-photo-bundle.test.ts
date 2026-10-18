import { describe, expect, it } from "vitest";
import {
  receiptPhotoBundleSchema,
  serializeReceiptPhotoBundle,
  RECEIPT_PHOTO_BUNDLE_VERSION,
  type ReceiptPhotoBundle,
} from "./receipt-photo-bundle";
const photo = {
  mimeType: "image/jpeg" as const,
  sizeBytes: 1,
  checksum: `sha256:${"a".repeat(64)}`,
  dataBase64: "AQ==",
};
const bundle: ReceiptPhotoBundle = {
  schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
  mode: "ONE_RECEIPT_MULTIPLE_PHOTOS" as const,
  views: [
    photo,
    { ...photo, checksum: `sha256:${"b".repeat(64)}`, dataBase64: "Ag==" },
  ],
};
describe("one immutable receipt, ordered original views", () => {
  it("serializes a stable bounded envelope regardless of property insertion order", () => {
    expect(serializeReceiptPhotoBundle(bundle)).toBe(
      serializeReceiptPhotoBundle({
        views: bundle.views.map((v) => ({
          dataBase64: v.dataBase64,
          checksum: v.checksum,
          sizeBytes: v.sizeBytes,
          mimeType: v.mimeType,
        })),
        mode: bundle.mode,
        schemaVersion: bundle.schemaVersion,
      }),
    );
    expect(serializeReceiptPhotoBundle(bundle)).not.toBe(
      serializeReceiptPhotoBundle({
        ...bundle,
        views: [...bundle.views].reverse(),
      }),
    );
  });
  it.each([
    { ...bundle, views: [photo] },
    { ...bundle, views: Array.from({ length: 6 }, () => photo) },
    { ...bundle, mode: "ONE_PHOTO_PER_RECEIPT" },
    { ...bundle, instruction: "publish" },
    { ...bundle, views: [photo, photo] },
    {
      ...bundle,
      views: [photo, { ...bundle.views[1], mimeType: "application/pdf" }],
    },
    { ...bundle, views: [photo, { ...bundle.views[1], dataBase64: "Ag=" }] },
    {
      ...bundle,
      views: [photo, { ...bundle.views[1], dataBase64: "https://example.com" }],
    },
    { ...bundle, views: [photo, { ...bundle.views[1], sizeBytes: 3 }] },
  ])("rejects malformed or ambiguous grouping %#", (input) => {
    expect(receiptPhotoBundleSchema.safeParse(input).success).toBe(false);
  });
});
