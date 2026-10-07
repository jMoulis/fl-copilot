import { z } from "zod";
const amount = z.number().finite().nonnegative();
const unit = z.enum(["KG", "PIECE", "PACK", "LOT", "OTHER"]);
const price = { amount, currency: z.literal("EUR"), unit };
export const commercialMechanismSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIXED_PRICE"), ...price }).strict(),
  z
    .object({
      type: z.literal("PRICE_CEILING"),
      ...price,
      operator: z.enum(["LESS_THAN", "LESS_THAN_OR_EQUAL"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("THRESHOLD_PRICE"),
      basePrice: amount,
      thresholdPrice: amount,
      thresholdQuantity: z.number().positive(),
      thresholdUnit: unit,
      priceUnit: unit,
    })
    .strict(),
  z
    .object({
      type: z.literal("CARD_BENEFIT"),
      benefitType: z.enum(["PERCENT", "AMOUNT"]),
      value: amount,
      scope: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("LOT"),
      lotQuantity: z.number().int().positive(),
      totalPrice: amount.nullable(),
      unitPrice: amount.nullable(),
      unit: z.enum(["PIECE", "PACK"]),
    })
    .strict(),
]);
export const commercialPurchaseConditionSchema = z
  .object({
    purchasePrice: amount.nullable(),
    unit: unit.nullable(),
    supplierDiscountPct: z.number().min(0).max(100).nullable(),
    minimumPurchaseQuantity: z.number().positive().nullable(),
    rawLabel: z.string().nullable(),
  })
  .strict();
export type CommercialMechanism = z.infer<typeof commercialMechanismSchema>;
export type CommercialPurchaseCondition = z.infer<
  typeof commercialPurchaseConditionSchema
>;
