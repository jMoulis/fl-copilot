import { z } from "zod";
import { copilotDocumentReferenceSchema } from "./copilot-commercial-documents";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { wasteReceiptSchema, wasteLineSchema } from "./waste-receipts";
import {
  wasteReceiptDraftSchema,
  wasteReceiptDraftLineSchema,
} from "./waste-receipt-draft";
import { wasteObservationSchema } from "./observations";
export const copilotReceiptInputSchema = z.strictObject({
  sourceDocumentId: z.string().uuid(),
  offset: z.number().int().min(0).max(10000),
  limit: z.number().int().min(1).max(10),
});
export const copilotReceiptResultSchema = z
  .strictObject({
    source: copilotDocumentReferenceSchema,
    status: z.enum(["NOT_READY", "EXTRACTED", "PUBLISHED", "LIMIT_EXCEEDED"]),
    published: z
      .strictObject({
        receipt: wasteReceiptSchema.pick({
          id: true,
          captureDate: true,
          detectedReceiptDate: true,
          confirmedWasteDate: true,
          detectedCashierNumber: true,
          confirmedCashierNumber: true,
          cashierNumberConfirmedAt: true,
          processingStatus: true,
          duplicateStatus: true,
          version: true,
        }),
        lines: z
          .array(
            wasteLineSchema
              .omit({
                extractionConfidence: true,
                sourceRegion: true,
                dirty: true,
                remoteVersion: true,
                syncState: true,
              })
              .extend({ productLabel: z.string().max(280) }),
          )
          .max(10),
        observations: z
          .array(
            wasteObservationSchema.omit({
              dirty: true,
              remoteVersion: true,
              syncState: true,
            }),
          )
          .max(10),
      })
      .nullable(),
    extracted: z
      .strictObject({
        header: wasteReceiptDraftSchema.omit({ lines: true }),
        lines: z
          .array(wasteReceiptDraftLineSchema.omit({ sourceRegion: true }))
          .max(10),
      })
      .nullable(),
    lineCount: z.number().int().nonnegative().nullable(),
    nextOffset: z.number().int().nonnegative().nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(12),
  })
  .superRefine((r, c) => {
    if (
      (r.status === "PUBLISHED") !== !!r.published ||
      (r.status === "EXTRACTED") !== !!r.extracted ||
      (["NOT_READY", "LIMIT_EXCEEDED"].includes(r.status) &&
        (r.lineCount !== null || r.nextOffset !== null))
    )
      c.addIssue({ code: "custom", message: "Invalid receipt state" });
  });
