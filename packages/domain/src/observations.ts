import { z } from "zod";
import { productNatureSchema } from "./products";

const idSchema = z.string().uuid();
const dateSchema = z.string().date();
const timestampSchema = z.string().datetime({ offset: true });
const decimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const nullableDecimalSchema = decimalSchema.nullable();

const observationMetadataSchema = z.object({
  id: idSchema,
  storeId: idSchema,
  productId: idSchema,
  businessDate: dateSchema,
  sourceDocumentId: idSchema,
  sourceRecordId: idSchema,
  validationStatus: z.literal("VALIDATED"),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
  syncState: z.literal("PENDING"),
  remoteVersion: z.number().int().nonnegative().nullable(),
  dirty: z.literal(true),
});

export const salesObservationSchema = observationMetadataSchema.extend({
  quantity: decimalSchema,
  purchaseValue: nullableDecimalSchema,
  rceValue: nullableDecimalSchema,
  salesValue: nullableDecimalSchema,
  vatValue: nullableDecimalSchema,
  marginValue: nullableDecimalSchema,
  marginRate: nullableDecimalSchema,
});

export const wasteObservationSchema = observationMetadataSchema.extend({
  productNature: productNatureSchema,
  quantity: nullableDecimalSchema,
  purchaseValueKnown: nullableDecimalSchema,
  purchaseValueEstimated: nullableDecimalSchema,
  salesValue: nullableDecimalSchema,
  costQuality: z.enum(["KNOWN", "ESTIMATED", "UNAVAILABLE"]),
  sourceType: z.enum(["MERCALYS", "WASTE_RECEIPT"]),
});

export type SalesObservation = z.infer<typeof salesObservationSchema>;
export type WasteObservation = z.infer<typeof wasteObservationSchema>;
