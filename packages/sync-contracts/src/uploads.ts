import { z } from "zod";
import {
  sourceTypeSchema,
  RECEIPT_PHOTO_BUNDLE_MIME,
  MAX_RECEIPT_BUNDLE_BYTES,
} from "@fl-copilot/domain";

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
  RECEIPT_PHOTO_BUNDLE_MIME,
]);

export const sourceUploadChecksumSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);

export const initSourceUploadRequestSchema = z
  .object({
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
  })
  .superRefine((input, context) => {
    if (
      input.mimeType === RECEIPT_PHOTO_BUNDLE_MIME &&
      (input.sourceType !== "WASTE_RECEIPT" ||
        input.sizeBytes > MAX_RECEIPT_BUNDLE_BYTES)
    ) {
      context.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: "Invalid receipt photo bundle upload",
      });
    }
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

export {
  wasteReceiptDraftCandidateSchema,
  wasteReceiptDraftLineSchema,
  wasteReceiptDraftSchema,
} from "@fl-copilot/domain";
import {
  wasteReceiptDraftSchema,
  wasteReceiptDraftLineSchema,
  wasteReceiptDraftCandidateSchema,
} from "@fl-copilot/domain";

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
