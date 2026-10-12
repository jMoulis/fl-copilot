import { z } from "zod";
import { copilotBusinessDateSchema } from "./copilot-context-tools";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { commercialVisualEvidenceSchema } from "./commercial-visual-reading";
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
