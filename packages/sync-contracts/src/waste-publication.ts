import { z } from "zod";
import {
  wasteReceiptSchema,
  wasteLineSchema,
  wasteObservationSchema,
  localSourceDocumentSchema,
} from "@fl-copilot/domain";

/** One immutable, atomic publication; device file paths never cross the API. */
export const wastePublicationSchema = z
  .object({
    receipt: wasteReceiptSchema.extend({
      processingStatus: z.literal("PUBLISHED"),
      confirmedWasteDate: z.string().date(),
      sourceDocumentId: z.string().uuid(),
      localFileId: z.null(),
    }),
    source: localSourceDocumentSchema.safeExtend({ localFileUri: z.null() }),
    lines: z.array(wasteLineSchema).min(1).max(1000),
    observations: z.array(wasteObservationSchema).min(1).max(1000),
  })
  .superRefine((value, context) => {
    const { receipt, source, lines, observations } = value;
    const fail = () =>
      context.addIssue({
        code: "custom",
        message: "Invalid waste publication lineage or validation.",
      });
    if (
      source.id !== receipt.sourceDocumentId ||
      source.storeId !== receipt.storeId ||
      source.sourceType !== "WASTE_RECEIPT" ||
      source.remoteUploadStatus !== "CONFIRMED" ||
      !source.checksum ||
      ["POSSIBLE_DUPLICATE", "CONFIRMED_DUPLICATE", "UNCHECKED"].includes(
        receipt.duplicateStatus,
      )
    )
      fail();
    if (
      new Set(lines.map((l) => l.id)).size !== lines.length ||
      new Set(lines.map((l) => l.sourceLineIndex)).size !== lines.length ||
      new Set(observations.map((o) => o.id)).size !== observations.length
    )
      fail();
    const active = lines.filter((l) => l.validationStatus !== "EXCLUDED");
    if (active.length !== observations.length) fail();
    for (const line of lines) {
      if (
        line.receiptId !== receipt.id ||
        line.storeId !== receipt.storeId ||
        line.deletedAt ||
        (line.validationStatus !== "VALID" &&
          line.validationStatus !== "EXCLUDED")
      )
        fail();
    }
    for (const line of active) {
      const o = observations.find((o) => o.sourceRecordId === line.id);
      if (
        !o ||
        line.matchStatus !== "MATCHED" ||
        !line.matchedProductId ||
        line.productNature === "UNKNOWN" ||
        line.totalPrice == null ||
        o.id !== line.id ||
        o.storeId !== receipt.storeId ||
        o.productId !== line.matchedProductId ||
        o.productNature !== line.productNature ||
        o.businessDate !== receipt.confirmedWasteDate ||
        o.sourceDocumentId !== source.id ||
        o.sourceType !== "WASTE_RECEIPT" ||
        o.salesValue !== line.totalPrice ||
        o.purchaseValueKnown !== null ||
        o.purchaseValueEstimated !== null ||
        o.costQuality !== "UNAVAILABLE" ||
        o.deletedAt
      )
        fail();
    }
  });
export type WastePublication = z.infer<typeof wastePublicationSchema>;
export const synchronizedWastePublicationSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  remoteVersion: z.number().int().positive(),
  publication: wastePublicationSchema,
});
export type SynchronizedWastePublication = z.infer<
  typeof synchronizedWastePublicationSchema
>;
