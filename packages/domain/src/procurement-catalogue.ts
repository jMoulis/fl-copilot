import { z } from "zod";

export const PROCUREMENT_PARSER_VERSION = "procurement-catalogue.v1";
export const MAX_PROCUREMENT_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_PROCUREMENT_OFFERS = 10_000;
const code = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v.trim().length > 0);
const label = z.string().min(1).max(2_000);
const instant = z.string().datetime({ offset: true });
const numeric = z.number().finite().nonnegative();
// A source number is retained, never rounded or converted to another unit.
const decimal = z
  .string()
  .max(100)
  .refine(
    (v) =>
      /^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v) &&
      Number.isFinite(Number(v)) &&
      Number(v) >= 0,
  );
const deadline = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  .refine(
    (v) =>
      z.iso.date().safeParse(v.slice(0, 10)).success &&
      Number(v.slice(11, 13)) < 24 &&
      Number(v.slice(14, 16)) < 60,
  );

/** Only the explicitly supported branches survive Zod's projection. */
export const procurementSourceArticleSchema = z.object({
  _id: code,
  productId: code,
  genericId: code,
  genericName: label,
  name: label,
  packagingCode: code,
  packagingName: label,
  packagingQuantity: numeric,
  weight: numeric,
  tva: numeric,
  origin: z.string().max(200).nullish(),
  famille: code.nullish(),
  univers: code.nullish(),
  creationDate: instant.nullish(),
  lastUpdate: instant,
});
export const procurementSourceQuoteSchema = z.object({
  _id: code,
  base: code,
  purchasePrice: numeric.nullish(),
  sellingPrice: numeric.nullish(),
  priceUnit: z.boolean().nullish(),
  indispo: z.boolean().nullish(),
  complementaire: z.boolean().nullish(),
  orderDeadlines: z.array(deadline).max(366).optional(),
  deliveryDates: z.array(z.iso.date()).max(366).optional(),
});
export const procurementSourceSchema = z.object({
  articles: z
    .array(procurementSourceArticleSchema)
    .min(1)
    .max(MAX_PROCUREMENT_OFFERS),
  assortment: z.object({
    _id: code,
    pdv: z.string().regex(/^\d{1,12}$/),
    lastUpdate: instant,
    articles: z.array(procurementSourceQuoteSchema).max(MAX_PROCUREMENT_OFFERS),
  }),
});

export const procurementTariffSchema = z.strictObject({
  base: code,
  purchasePrice: decimal.nullable(),
  sellingPrice: decimal.nullable(),
  priceUnit: z.boolean().nullable(),
  unavailable: z.boolean().nullable(),
  complementary: z.boolean().nullable(),
  // Source-local deadlines have no timezone. Do not convert them to UTC.
  orderDeadlines: z.array(deadline).max(366),
  deliveryDates: z.array(z.iso.date()).max(366),
});
export const procurementCatalogueOfferSchema = z.strictObject({
  sourceIndex: z.number().int().nonnegative(),
  offerId: code,
  supplierProductId: code,
  genericId: code,
  genericLabel: label,
  label,
  packagingCode: code,
  packagingLabel: label,
  packagingQuantity: decimal,
  weight: decimal,
  vatMultiplier: decimal,
  origin: z.string().max(200).nullable(),
  sourceFamily: code.nullable(),
  sourceUniverse: code.nullable(),
  sourceCreatedAt: instant.nullable(),
  sourceUpdatedAt: instant,
  tariff: procurementTariffSchema.nullable(),
});
export const procurementCatalogueSchema = z
  .strictObject({
    parserVersion: z.literal(PROCUREMENT_PARSER_VERSION),
    pdv: z.string().regex(/^\d{1,12}$/),
    assortmentId: code,
    asOf: instant,
    offers: z
      .array(procurementCatalogueOfferSchema)
      .min(1)
      .max(MAX_PROCUREMENT_OFFERS),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    const indexes = new Set<number>();
    for (const [i, offer] of v.offers.entries()) {
      if (ids.has(offer.offerId) || indexes.has(offer.sourceIndex))
        ctx.addIssue({
          code: "custom",
          path: ["offers", i],
          message: "Duplicate offer identity",
        });
      ids.add(offer.offerId);
      indexes.add(offer.sourceIndex);
    }
  });

/** Only a local review draft; this is deliberately not a published sync entity. */
export const procurementCatalogueDraftSchema = z.strictObject({
  id: z.uuid(),
  storeId: z.uuid(),
  ownerId: z.uuid(),
  sourceDocumentId: z.uuid(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  normalizedChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  importedAt: instant,
  catalogue: procurementCatalogueSchema,
});
export type ProcurementCatalogue = z.infer<typeof procurementCatalogueSchema>;
export type ProcurementCatalogueOffer = z.infer<
  typeof procurementCatalogueOfferSchema
>;
export type ProcurementCatalogueDraft = z.infer<
  typeof procurementCatalogueDraftSchema
>;
