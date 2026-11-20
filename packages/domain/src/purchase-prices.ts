import { z } from "zod";
import { salesUnitSchema } from "./products";

export const purchasePriceQuoteSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  sourceActive: z.boolean(),
  nomenclature: z.string(),
  reference: z
    .object({
      sellingPriceTtc: z.string().regex(/^\d+(?:\.\d+)?$/),
      vatRate: z.string().regex(/^\d+(?:\.\d+)?$/),
    })
    .optional(),
});
export function referencePriceUnavailable(
  amount: string,
  sellingPriceTtc?: string | null,
) {
  return (
    Number(amount) === 0.01 ||
    Number(amount) === 0.001 ||
    Number(amount) === 999 ||
    Number(sellingPriceTtc) === 999
  );
}
export function purchasePriceNeedsReview(amount: string) {
  // Exact source values agreed by the owner, not a generic low-price threshold.
  return /^0*\.0*10*$/.test(amount) && [0.01, 0.001].includes(Number(amount));
}
export const purchasePriceObservationSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  businessDate: z.string().date(),
  amount: purchasePriceQuoteSchema.shape.amount,
  sellingPriceTtc: purchasePriceQuoteSchema.shape.amount.nullable().optional(),
  vatRate: purchasePriceQuoteSchema.shape.amount.nullable().optional(),
  referenceStatus: z
    .enum(["AVAILABLE", "TEMPORARILY_UNAVAILABLE"])
    .nullable()
    .optional(),
  unit: salesUnitSchema,
  taxBasis: z.literal("HT"),
  currency: z.literal("EUR"),
  priceStatus: z.enum(["KNOWN", "TO_VERIFY"]),
  confirmedAt: z.string().datetime({ offset: true }).nullable(),
  sourceDocumentId: z.string().uuid(),
  sourceRecordId: z.string().uuid(),
  validationStatus: z.literal("VALIDATED"),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  syncState: z.literal("PENDING"),
  remoteVersion: z.number().int().nonnegative().nullable(),
  dirty: z.literal(true),
});
export type PurchasePriceObservation = z.infer<
  typeof purchasePriceObservationSchema
>;
