import { z } from "zod";
import { sourceTypeSchema } from "@fl-copilot/domain";

const uploadSourceTypeSchema = sourceTypeSchema.extract([
  "MERCALYS_SALES",
  "MERCALYS_WASTE",
  "WASTE_RECEIPT",
  "WEEKLY_COMMERCIAL_PDF",
]);

export const sourceUploadMimeTypeSchema = z.enum([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
]);

export const sourceUploadChecksumSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);

export const initSourceUploadRequestSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  sourceType: uploadSourceTypeSchema,
  filename: z.string().trim().min(1).max(255),
  mimeType: sourceUploadMimeTypeSchema,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  checksum: sourceUploadChecksumSchema,
});

export const initSourceUploadResponseSchema = z.object({
  uploadId: z.string().uuid(),
  objectKey: z.string().min(1),
  status: z.enum(["UPLOAD_REQUIRED", "ALREADY_UPLOADED"]),
  uploadUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime().nullable(),
  headers: z.record(z.string(), z.string()),
});

export const completeSourceUploadRequestSchema = z.object({
  checksum: sourceUploadChecksumSchema,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
});

const decimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

export const wasteReceiptDraftCandidateSchema = z.object({
  productId: z.string().uuid(),
  label: z.string().trim().min(1).max(240),
  nature: z.enum(["BULK", "PACKAGED", "UNKNOWN"]),
  salesUnit: z.enum(["KG", "PIECE", "PACK", "UNKNOWN"]),
  score: z.number().min(0).max(1),
});

export const wasteReceiptDraftLineSchema = z.object({
  lineId: z.string().uuid(),
  sourceLineIndex: z.number().int().nonnegative(),
  rawLabel: z.string().trim().min(1).max(240),
  quantity: decimalStringSchema.nullable(),
  weight: decimalStringSchema.nullable(),
  quantityUnit: z.enum(["KG", "PIECE", "PACK", "UNKNOWN"]),
  unitPrice: decimalStringSchema.nullable(),
  totalPrice: decimalStringSchema.nullable(),
  extractionConfidence: z.json().nullable(),
  sourceRegion: z.json().nullable(),
  arithmeticStatus: z.enum(["NOT_CHECKED", "CONSISTENT", "MISMATCH"]),
  arithmeticExpectedTotal: decimalStringSchema.nullable(),
  arithmeticDifference: decimalStringSchema.nullable(),
  arithmeticWarningCode: z.literal("AMOUNT_TO_REVIEW").nullable(),
  matchState: z.enum(["AUTO_MATCH", "REVIEW", "AMBIGUOUS", "NO_MATCH"]),
  matchedProductId: z.string().uuid().nullable(),
  matchedProductLabel: z.string().trim().min(1).max(240).nullable(),
  matchConfidence: z.number().min(0).max(1).nullable(),
  productNature: z.enum(["BULK", "PACKAGED", "UNKNOWN"]),
  candidates: z.array(wasteReceiptDraftCandidateSchema),
  validationStatus: z.enum(["PENDING", "TO_REVIEW"]),
});

export const wasteReceiptDraftSchema = z.object({
  detectedReceiptDate: z.string().date().nullable(),
  detectedCashierNumber: z.string().trim().min(1).max(64).nullable().optional(),
  extractionModelVersion: z.string().min(1),
  arithmeticValidatorVersion: z.string().min(1),
  productMatcherVersion: z.string().min(1),
  lines: z.array(wasteReceiptDraftLineSchema),
});

export const wasteReceiptDuplicateSchema = z.object({
  status: z.literal("POSSIBLE_DUPLICATE"),
  reason: z.literal("EXACT_IMAGE_CHECKSUM"),
  candidateSourceDocumentId: z.string().uuid(),
});

export const completeSourceUploadResponseSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  remoteUploadStatus: z.enum(["CONFIRMED", "DUPLICATE", "INVALID"]),
  jobId: z.string().uuid().nullable().optional(),
  wasteReceiptDraft: wasteReceiptDraftSchema.nullable().optional(),
  wasteReceiptDuplicate: wasteReceiptDuplicateSchema.nullable().optional(),
});

export const verifyImportRequestSchema = z.object({
  sourceType: uploadSourceTypeSchema.extract([
    "MERCALYS_SALES",
    "MERCALYS_WASTE",
  ]),
  checksum: sourceUploadChecksumSchema,
  businessPeriodStart: z.string().date(),
  businessPeriodEnd: z.string().date(),
  localNormalizedFingerprint: z.string().trim().min(1).max(200),
  localRecordCount: z.number().int().nonnegative(),
});

export const importVerificationResultSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  status: z.enum(["MATCH", "DIFFERENCE", "FAILED"]),
  localFingerprint: z.string().nullable().optional(),
  remoteFingerprint: z.string().nullable().optional(),
  differenceSummary: z
    .object({
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      modified: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export type InitSourceUploadRequest = z.infer<
  typeof initSourceUploadRequestSchema
>;
export type InitSourceUploadResponse = z.infer<
  typeof initSourceUploadResponseSchema
>;
export type CompleteSourceUploadRequest = z.infer<
  typeof completeSourceUploadRequestSchema
>;
export type CompleteSourceUploadResponse = z.infer<
  typeof completeSourceUploadResponseSchema
>;
export type WasteReceiptDraft = z.infer<typeof wasteReceiptDraftSchema>;
export type WasteReceiptDraftLine = z.infer<typeof wasteReceiptDraftLineSchema>;
export type WasteReceiptDraftCandidate = z.infer<
  typeof wasteReceiptDraftCandidateSchema
>;
export type WasteReceiptDuplicate = z.infer<typeof wasteReceiptDuplicateSchema>;
export type VerifyImportRequest = z.infer<typeof verifyImportRequestSchema>;
export type ImportVerificationResult = z.infer<
  typeof importVerificationResultSchema
>;
