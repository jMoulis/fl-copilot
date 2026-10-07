import { z } from "zod";
import { commercialEvidenceSchema } from "./commercial-ai-drafts";
import {
  commercialMechanismSchema,
  commercialPurchaseConditionSchema,
} from "./commercial-mechanisms";
export const commercialOfferCandidateSchema = z
  .object({
    storeId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    pageNumber: z.number().int().min(1).max(100),
    sourceBlockIndex: z.number().int().nonnegative(),
    // Explicit source operation identity; never borrowed from a neighbouring offer.
    operationKey: z.string().trim().min(1).nullable(),
    productId: z.string().uuid().nullable(),
    rawProductLabel: z.string().trim().min(1).nullable(),
    productIdentifiers: z.array(z.string().trim().min(1)).max(20),
    saleStart: z.string().trim().min(1).nullable(),
    saleEnd: z.string().trim().min(1).nullable(),
    mechanism: commercialMechanismSchema.nullable(),
    purchaseCondition: commercialPurchaseConditionSchema.nullable(),
    rawMechanism: z.string().nullable(),
    rawPriceOperator: z.string().nullable(),
    rawSalesUnit: z.string().nullable(),
    rawPurchasePrice: z.string().nullable(),
    rawSellingPrice: z.string().nullable(),
    evidence: z.array(commercialEvidenceSchema).min(1).max(8),
  })
  .strict();
export const commercialOfferConflictCodeSchema = z.enum([
  "SELLING_MECHANISM_CONFLICT",
  "SALE_PERIOD_CONFLICT",
  "PURCHASE_CONDITION_CONFLICT",
  "UNRESOLVED_MECHANISM_CONFLICT",
]);
export type CommercialOfferCandidate = z.infer<
  typeof commercialOfferCandidateSchema
>;
export type CommercialOfferConflictCode = z.infer<
  typeof commercialOfferConflictCodeSchema
>;
