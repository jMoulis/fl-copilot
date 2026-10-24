import { z } from "zod";
import { copilotBusinessDateSchema } from "./copilot-context-tools";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { commercialVisualEvidenceSchema } from "./commercial-visual-reading";
export const MAX_COPILOT_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_COPILOT_PDF_PAGES = 16;
export const copilotOriginalPdfInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
});
/** Metadata only. Original bytes never enter the read journal or saved message. */
export const copilotOriginalPdfSnapshotSchema = z
  .strictObject({
    status: z.literal("AVAILABLE"),
    source: z.strictObject({
      sourceDocumentId: z.uuid(),
      filename: z.string().min(1).max(240),
      checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      registeredAt: z.iso.datetime(),
      sizeBytes: z.number().int().positive().max(MAX_COPILOT_PDF_BYTES),
      pageCount: z.number().int().positive().max(MAX_COPILOT_PDF_PAGES),
    }),
    evidence: z.array(copilotEvidenceSchema).length(1),
  })
  .superRefine((value, ctx) => {
    const evidence = value.evidence[0]!;
    if (
      evidence.sourceId !== value.source.sourceDocumentId ||
      evidence.sourceType !== "SOURCE_DOCUMENT" ||
      evidence.factKind !== "QUALITY" ||
      evidence.sourceVersion !== null ||
      evidence.id !==
        `pdf-original/${value.source.checksum.slice(7)}/${value.source.sourceDocumentId}`
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid original PDF source evidence",
      });
  });
/** Ephemeral server transport, never a persisted or syncable domain entity. */
export type CopilotOriginalPdfRead = {
  snapshot: z.infer<typeof copilotOriginalPdfSnapshotSchema>;
  pdf: Uint8Array;
};
/** Source observations, never canonical store figures or approved offer terms. */
export const copilotPdfObservationsSchema = z
  .array(
    z.strictObject({
      sourceDocumentId: z.uuid(),
      pageNumber: z.number().int().positive().max(MAX_COPILOT_PDF_PAGES),
      text: z.string().trim().min(1).max(1200),
    }),
  )
  .max(12);
export const copilotDocumentsInputSchema = z.strictObject({
  cursor: z
    .strictObject({ createdAt: z.string().datetime(), id: z.string().uuid() })
    .nullable(),
  limit: z.number().int().min(1).max(5),
});
export const copilotDocumentReferenceSchema = z.strictObject({
  sourceDocumentId: z.string().uuid(),
  filename: z.string().min(1).max(240),
  createdAt: z.string().datetime(),
});
export const copilotDocumentsResultSchema = z.strictObject({
  documents: z.array(copilotDocumentReferenceSchema).max(5),
  nextCursor: copilotDocumentsInputSchema.shape.cursor,
  evidence: z.array(copilotEvidenceSchema).max(6),
});
export const copilotPdfInputSchema = z.strictObject({
  sourceDocumentId: z.string().uuid(),
  businessDate: copilotBusinessDateSchema,
  pageNumber: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(10000),
  limit: z.number().int().min(1).max(16),
});
export const copilotPdfResultSchema = z.strictObject({
  sourceDocumentId: z.string().uuid(),
  businessDate: copilotBusinessDateSchema,
  pageNumber: z.number().int().min(1).max(100),
  pageCount: z.number().int().min(1).max(100).nullable(),
  status: z.enum(["READY", "NOT_READY"]),
  week: z.strictObject({
    date: copilotBusinessDateSchema,
    year: z.number().int(),
    number: z.number().int(),
    start: copilotBusinessDateSchema,
    end: copilotBusinessDateSchema,
  }),
  entries: z
    .array(
      z.strictObject({
        id: z.string(),
        label: z.string().max(600),
        value: z.string().max(2000).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
        citations: z.array(commercialVisualEvidenceSchema).max(8),
        verification: z
          .array(z.enum(["TEXT_SUPPORTED", "VISUAL_TO_VERIFY"]))
          .max(8),
      }),
    )
    .max(16),
  nextOffset: z.number().int().nonnegative().nullable(),
  excludedOperations: z.number().int().nonnegative(),
  unknownOperations: z.number().int().nonnegative(),
  evidence: z.array(copilotEvidenceSchema).max(18),
});
