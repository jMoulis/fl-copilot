import { z } from "zod";
import { commercialMechanismSchema } from "./commercial-mechanisms";
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Date de vente invalide.");
export const commercialOfferSourceSchema = z
  .object({
    sourceDocumentId: z.string().uuid(),
    readingId: z.string().uuid(),
    checksum: z.string().min(1),
    operationIndex: z.number().int().min(0).max(29),
    itemIndex: z.number().int().min(0).max(59),
  })
  .strict();
/** An explicitly reviewed excerpt of the real original; never an invented extraction ID. */
export const commercialOriginalOfferSourceSchema = z.strictObject({
  kind: z.literal("PDF_ORIGINAL"),
  sourceDocumentId: z.uuid(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pageNumber: z.number().int().min(1).max(16),
  excerpt: z.string().trim().min(1).max(1200),
});
export const commercialChoiceSourceSchema = z.union([
  commercialOfferSourceSchema,
  commercialOriginalOfferSourceSchema,
]);
export const commercialOfferChoiceSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    source: commercialChoiceSourceSchema,
    operationKind: z.enum(["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"]),
    operationLabel: z.string().trim().min(1).max(240),
    rawProductLabel: z.string().trim().min(1).max(240),
    productId: z.string().uuid(),
    saleStart: calendarDate,
    saleEnd: calendarDate,
    mechanism: commercialMechanismSchema,
    applicabilityConfirmed: z.literal(true),
    criticalFieldsConfirmed: z.literal(true),
    status: z.enum(["RETAINED", "WITHDRAWN"]),
    note: z.string().trim().max(1200).nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((choice, ctx) => {
    if (
      choice.mechanism.type === "CARD_BENEFIT" &&
      (choice.mechanism.scope?.length ?? 0) > 1200
    )
      ctx.addIssue({
        code: "custom",
        path: ["mechanism", "scope"],
        message: "La portée de l’avantage carte est trop longue.",
      });
    if (
      choice.mechanism.type === "LOT" &&
      choice.mechanism.totalPrice === null &&
      choice.mechanism.unitPrice === null
    )
      ctx.addIssue({
        code: "custom",
        path: ["mechanism"],
        message: "Précisez le prix total ou unitaire du lot.",
      });
    if (
      choice.mechanism.type === "LOT" &&
      choice.mechanism.totalPrice !== null &&
      choice.mechanism.unitPrice !== null &&
      Math.abs(
        Math.round(choice.mechanism.totalPrice * 100) -
          Math.round(choice.mechanism.unitPrice * 100) *
            choice.mechanism.lotQuantity,
      ) > Math.ceil(choice.mechanism.lotQuantity / 2)
    )
      ctx.addIssue({
        code: "custom",
        path: ["mechanism"],
        message: "Les prix total et unitaire du lot sont incohérents.",
      });
    if (choice.saleEnd < choice.saleStart)
      ctx.addIssue({
        code: "custom",
        path: ["saleEnd"],
        message: "La fin doit suivre le début de vente.",
      });
    if (
      choice.mechanism.type === "CARD_BENEFIT" &&
      choice.mechanism.benefitType === "PERCENT" &&
      choice.mechanism.value > 100
    )
      ctx.addIssue({
        code: "custom",
        path: ["mechanism", "value"],
        message: "L’avantage carte ne peut pas dépasser 100 %.",
      });
    if ("unit" in choice.mechanism && choice.mechanism.unit === "OTHER")
      ctx.addIssue({
        code: "custom",
        path: ["mechanism", "unit"],
        message: "Précisez l’unité de vente.",
      });
    if (
      choice.mechanism.type === "THRESHOLD_PRICE" &&
      (choice.mechanism.priceUnit === "OTHER" ||
        choice.mechanism.thresholdUnit === "OTHER")
    )
      ctx.addIssue({
        code: "custom",
        path: ["mechanism"],
        message: "Précisez les unités du seuil et du prix.",
      });
  });
export type CommercialOfferSource = z.infer<typeof commercialOfferSourceSchema>;
export type CommercialChoiceSource = z.infer<
  typeof commercialChoiceSourceSchema
>;
export type CommercialOriginalOfferSource = z.infer<
  typeof commercialOriginalOfferSourceSchema
>;
export function isCommercialOriginalSource(
  source: CommercialChoiceSource,
): source is CommercialOriginalOfferSource {
  return "kind" in source && source.kind === "PDF_ORIGINAL";
}
export type CommercialOfferChoice = z.infer<typeof commercialOfferChoiceSchema>;
