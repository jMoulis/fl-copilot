import { describe, expect, it } from "vitest";
import {
  RECEIPT_PHOTO_BUNDLE_MIME,
  MAX_RECEIPT_BUNDLE_BYTES,
} from "@fl-copilot/domain";
import { initSourceUploadRequestSchema } from "./uploads";
const photo = { checksum: `sha256:${"a".repeat(64)}` };
describe("receipt bundle upload boundary", () => {
  it("only admits this container as a bounded receipt upload", () => {
    const input = {
      sourceDocumentId: "11111111-1111-4111-8111-111111111111",
      sourceType: "WASTE_RECEIPT",
      filename: "ticket.flreceipt",
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      sizeBytes: 500,
      checksum: photo.checksum,
    };
    expect(initSourceUploadRequestSchema.safeParse(input).success).toBe(true);
    for (const sourceType of [
      "WEEKLY_COMMERCIAL_PDF",
      "MERCALYS_WASTE",
      "MERCALYS_SALES",
    ])
      expect(
        initSourceUploadRequestSchema.safeParse({ ...input, sourceType })
          .success,
      ).toBe(false);
    expect(
      initSourceUploadRequestSchema.safeParse({
        ...input,
        sizeBytes: MAX_RECEIPT_BUNDLE_BYTES + 1,
      }).success,
    ).toBe(false);
  });
});
