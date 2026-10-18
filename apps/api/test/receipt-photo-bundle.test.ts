import { describe, expect, it } from "vitest";
import {
  serializeReceiptPhotoBundle,
  RECEIPT_PHOTO_BUNDLE_VERSION,
} from "@fl-copilot/domain";
import {
  decodeReceiptPhotoBundle,
  receiptBytesChecksum,
} from "../src/uploads/receipt-photo-bundle";
const image = new Uint8Array([1, 2, 3]),
  second = new Uint8Array([4]);
function source() {
  return new TextEncoder().encode(
    serializeReceiptPhotoBundle({
      schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
      mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
      views: [image, second].map((bytes) => ({
        mimeType: "image/jpeg",
        sizeBytes: bytes.length,
        checksum: receiptBytesChecksum(bytes),
        dataBase64: Buffer.from(bytes).toString("base64"),
      })),
    }),
  );
}
describe("byte-verified receipt bundle decoding", () => {
  it("returns separate immutable original bytes in declared order", () => {
    const bytes = source(),
      original = bytes.slice();
    expect(
      decodeReceiptPhotoBundle(bytes, {
        checksum: receiptBytesChecksum(bytes),
        sizeBytes: bytes.length,
      }).map((v) => v.bytes),
    ).toEqual([image, second]);
    expect(bytes).toEqual(original);
  });
  it.each([
    "sourceHash",
    "sourceSize",
    "viewHash",
    "viewSize",
    "invalidJson",
    "noncanonicalBase64",
  ])("rejects %s without leaking document content", (mode) => {
    let bytes = source();
    if (
      mode === "viewHash" ||
      mode === "viewSize" ||
      mode === "noncanonicalBase64"
    ) {
      const json = JSON.parse(Buffer.from(bytes).toString());
      if (mode === "viewHash")
        json.views[0].checksum = `sha256:${"f".repeat(64)}`;
      if (mode === "viewSize") json.views[0].sizeBytes += 1;
      if (mode === "noncanonicalBase64") json.views[1].dataBase64 = "BB==";
      bytes = Buffer.from(JSON.stringify(json));
    }
    if (mode === "invalidJson")
      bytes = Buffer.from("secret malformed document");
    expect(() =>
      decodeReceiptPhotoBundle(bytes, {
        checksum:
          mode === "sourceHash"
            ? `sha256:${"a".repeat(64)}`
            : receiptBytesChecksum(bytes),
        sizeBytes: bytes.length + (mode === "sourceSize" ? 1 : 0),
      }),
    ).toThrow("WASTE_RECEIPT_PHOTO_BUNDLE_INVALID");
  });
});
