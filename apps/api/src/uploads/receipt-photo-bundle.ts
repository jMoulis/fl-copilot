import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MAX_RECEIPT_BUNDLE_BYTES,
  MAX_RECEIPT_VIEWS,
  receiptPhotoBundleSchema,
} from "@fl-copilot/domain";
import { AuthError } from "../auth/service.js";

export function receiptBytesChecksum(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function decodeReceiptPhotoBundle(
  bytes: Uint8Array,
  expected: { checksum: string; sizeBytes: number },
) {
  try {
    if (
      bytes.byteLength > MAX_RECEIPT_BUNDLE_BYTES ||
      bytes.byteLength !== expected.sizeBytes ||
      receiptBytesChecksum(bytes) !== expected.checksum
    )
      throw new Error();
    const bundle = receiptPhotoBundleSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return bundle.views.map((view) => {
      const original = Buffer.from(view.dataBase64, "base64");
      if (
        original.byteLength !== view.sizeBytes ||
        original.toString("base64") !== view.dataBase64 ||
        receiptBytesChecksum(original) !== view.checksum
      )
        throw new Error();
      return {
        bytes: new Uint8Array(original),
        checksum: view.checksum,
        mimeType: view.mimeType,
      };
    });
  } catch {
    throw new AuthError(
      422,
      "WASTE_RECEIPT_PHOTO_BUNDLE_INVALID",
      "Les photos de ce ticket ne correspondent pas au fichier conservé. Conservez les originaux et importez à nouveau les vues du même ticket.",
    );
  }
}

export const MAX_NORMALIZED_RECEIPT_VIEW_BYTES = 10 * 1024 * 1024;
export const MAX_NORMALIZED_RECEIPT_BYTES = 24 * 1024 * 1024;

export const normalizedReceiptViewSchema = z
  .object({
    imageIndex: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_RECEIPT_VIEWS - 1),
    objectKey: z.string().min(1).max(600),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_NORMALIZED_RECEIPT_VIEW_BYTES),
  })
  .strict();
export const normalizedReceiptViewsSchema = z
  .array(normalizedReceiptViewSchema)
  .min(2)
  .max(MAX_RECEIPT_VIEWS)
  .refine(
    (views) =>
      views.reduce((total, view) => total + view.sizeBytes, 0) <=
      MAX_NORMALIZED_RECEIPT_BYTES,
  );
export type NormalizedReceiptView = z.infer<typeof normalizedReceiptViewSchema>;

export function receiptViewDerivativeObjectKey(
  storeId: string,
  sourceDocumentId: string,
  imageIndex: number,
) {
  return `derivatives/${storeId}/${sourceDocumentId}/multiview-v1/${imageIndex}.jpg`;
}
