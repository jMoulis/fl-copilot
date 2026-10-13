import { z } from "zod";
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
