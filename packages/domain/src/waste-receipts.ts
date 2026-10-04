import { z } from "zod";
import { productNatureSchema } from "./products";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable().optional();
const dateSchema = z.string().date();
const nullableDateSchema = dateSchema.nullable().optional();
const nullableIdSchema = idSchema.nullable().optional();
const nullableDecimalSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .nullable()
  .optional();

export const wasteReceiptProcessingStatusSchema = z.enum([
  "CAPTURED",
  "UPLOAD_PENDING",
  "UPLOADED",
  "EXTRACTING",
  "TO_VALIDATE",
  "VALIDATED",
  "PUBLISHED",
  "FAILED",
]);

export const wasteReceiptAiStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

export const wasteReceiptDuplicateStatusSchema = z.enum([
  "UNCHECKED",
  "UNIQUE",
  "POSSIBLE_DUPLICATE",
  "CONFIRMED_DUPLICATE",
  "NOT_DUPLICATE",
]);

export const wasteReceiptDuplicateReasonSchema = z.enum([
  "EXACT_IMAGE_CHECKSUM",
]);

export const wasteReceiptSyncStateSchema = z.enum([
  "LOCAL_ONLY",
  "PENDING",
  "SYNCED",
  "CONFLICT",
  "ERROR",
]);

export const wasteLineMatchStatusSchema = z.enum([
  "MATCHED",
  "AMBIGUOUS",
  "UNMATCHED",
]);

export const wasteLineValidationStatusSchema = z.enum([
  "PENDING",
  "VALID",
  "TO_REVIEW",
  "EXCLUDED",
]);

export const wasteLineQuantityUnitSchema = z.enum([
  "KG",
  "PIECE",
  "PACK",
  "UNKNOWN",
]);

export const wasteReceiptSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  sourceDocumentId: nullableIdSchema,
  localFileId: nullableIdSchema,
  captureDate: nullableTimestampSchema,
  detectedReceiptDate: nullableDateSchema,
  confirmedWasteDate: nullableDateSchema,
  processingStatus: wasteReceiptProcessingStatusSchema,
  aiStatus: wasteReceiptAiStatusSchema,
  duplicateStatus: wasteReceiptDuplicateStatusSchema,
  duplicateCandidateSourceDocumentId: nullableIdSchema,
  duplicateReason: wasteReceiptDuplicateReasonSchema.nullable().optional(),
  note: z.string().trim().min(1).nullable().optional(),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: nullableTimestampSchema,
  syncState: wasteReceiptSyncStateSchema,
  remoteVersion: z.number().int().nonnegative().nullable().optional(),
  dirty: z.boolean(),
});

export const wasteLineSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  receiptId: idSchema,
  sourceLineIndex: z.number().int().nonnegative(),
  rawLabel: z.string().trim().min(1),
  quantity: nullableDecimalSchema,
  weight: nullableDecimalSchema,
  quantityUnit: wasteLineQuantityUnitSchema.nullable().optional(),
  unitPrice: nullableDecimalSchema,
  totalPrice: nullableDecimalSchema,
  matchedProductId: nullableIdSchema,
  matchStatus: wasteLineMatchStatusSchema,
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  productNature: productNatureSchema,
  extractionConfidence: z.json().nullable().optional(),
  sourceRegion: z.json().nullable().optional(),
  validationStatus: wasteLineValidationStatusSchema,
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: nullableTimestampSchema,
  syncState: wasteReceiptSyncStateSchema,
  remoteVersion: z.number().int().nonnegative().nullable().optional(),
  dirty: z.boolean(),
});

export type WasteReceipt = z.infer<typeof wasteReceiptSchema>;
export type WasteLine = z.infer<typeof wasteLineSchema>;
