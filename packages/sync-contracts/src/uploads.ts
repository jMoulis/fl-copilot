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

export const completeSourceUploadResponseSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  remoteUploadStatus: z.enum(["CONFIRMED", "DUPLICATE", "INVALID"]),
  jobId: z.string().uuid().nullable().optional(),
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
