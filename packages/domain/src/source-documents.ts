import { z } from "zod";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const dateSchema = z.string().date();
const versionSchema = z.number().int().nonnegative();
const nullableTimestampSchema = timestampSchema.nullable().optional();
const nullableDateSchema = dateSchema.nullable().optional();
const nullableStringSchema = z.string().trim().min(1).nullable().optional();

export const sourceTypeSchema = z.enum([
  "MERCALYS_SALES",
  "MERCALYS_WASTE",
  "WASTE_RECEIPT",
  "WEEKLY_COMMERCIAL_PDF",
  "WEATHER",
  "PUBLIC_HOLIDAY",
  "SCHOOL_HOLIDAY",
  "MANUAL_EVENT",
  "MANUAL_PRODUCT_DATA",
]);

export const localSourceProcessingStatusSchema = z.enum([
  "PENDING",
  "DETECTING",
  "PARSING",
  "TO_VALIDATE",
  "VALIDATED",
  "RECONCILING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);

export const remoteUploadStatusSchema = z.enum([
  "LOCAL_ONLY",
  "PENDING",
  "UPLOADING",
  "CONFIRMED",
  "DUPLICATE",
  "INVALID",
  "FAILED",
]);

export const remoteSourceProcessingStatusSchema = z.enum([
  "UPLOADED",
  "DETECTING",
  "PARSING",
  "EXTRACTING",
  "TO_VALIDATE",
  "VALIDATED",
  "RECONCILING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);

export const localSourceSyncStateSchema = z.enum([
  "LOCAL_ONLY",
  "PENDING",
  "SYNCED",
  "CONFLICT",
  "ERROR",
]);

export const sourceRecordStatusSchema = z.enum([
  "RAW",
  "PARSED",
  "VALID",
  "WARNING",
  "ERROR",
  "IGNORED",
  "PUBLISHED",
]);

export const localFileRetentionStatusSchema = z.enum([
  "RETAINED",
  "CLEANUP_ELIGIBLE",
  "REMOVED",
]);

export const localSourceDocumentSchema = z
  .object({
    id: idSchema,
    storeId: idSchema,
    sourceType: sourceTypeSchema,
    originalFilename: nullableStringSchema,
    localFileUri: nullableStringSchema,
    checksum: nullableStringSchema,
    sourceGeneratedAt: nullableTimestampSchema,
    businessPeriodStart: nullableDateSchema,
    businessPeriodEnd: nullableDateSchema,
    localProcessingStatus: localSourceProcessingStatusSchema,
    remoteUploadStatus: remoteUploadStatusSchema,
    remoteProcessingStatus: remoteSourceProcessingStatusSchema
      .nullable()
      .optional(),
    parserVersion: nullableStringSchema,
    extractionModelVersion: nullableStringSchema,
    version: versionSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: nullableTimestampSchema,
    syncState: localSourceSyncStateSchema,
    remoteVersion: versionSchema.nullable().optional(),
    dirty: z.boolean(),
  })
  .superRefine((document, context) => {
    if (
      document.businessPeriodStart &&
      document.businessPeriodEnd &&
      document.businessPeriodStart > document.businessPeriodEnd
    ) {
      context.addIssue({
        code: "custom",
        path: ["businessPeriodEnd"],
        message: "Business period end must not precede its start.",
      });
    }
  });

export const sourceRecordSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  sourceDocumentId: idSchema,
  sourceIndex: z.number().int().nonnegative().nullable().optional(),
  sourcePage: z.number().int().positive().nullable().optional(),
  rawPayload: z.json(),
  normalizedPayload: z.json().nullable().optional(),
  status: sourceRecordStatusSchema,
  errorCodes: z.array(z.string().trim().min(1)),
  warningCodes: z.array(z.string().trim().min(1)),
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: nullableTimestampSchema,
});

export const localFileMetadataSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  sourceDocumentId: idSchema.nullable().optional(),
  localUri: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().trim().min(1),
  retentionStatus: localFileRetentionStatusSchema,
  uploadStatus: remoteUploadStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type LocalSourceDocument = z.infer<typeof localSourceDocumentSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type LocalFileMetadata = z.infer<typeof localFileMetadataSchema>;
