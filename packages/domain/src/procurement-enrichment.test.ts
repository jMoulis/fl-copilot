import { expect, it } from "vitest";
import {
  buildProcurementEnrichment,
  type EnrichmentSource,
} from "./procurement-enrichment";
import { productSchema, type Product } from "./products";
const uuid = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const time = "2026-11-21T05:00:00.000Z",
  hash = "sha256:" + "a".repeat(64);
const product = productSchema.parse({
  id: uuid(1),
  storeId: uuid(2),
  label: "Produit",
  category: "UNKNOWN",
  nature: "UNKNOWN",
  salesUnit: "UNKNOWN",
  packaging: null,
  status: "ACTIVE",
  version: 1,
  createdAt: time,
  updatedAt: time,
  deletedAt: null,
});
function source(label: string, index = 3): EnrichmentSource {
  const genericId = String(index);
  return {
    catalogueSnapshotId: uuid(4),
    catalogueChecksum: hash,
    catalogue: {
      parserVersion: "procurement-catalogue.v1",
      pdv: "9083",
      assortmentId: "x",
      asOf: time,
      offers: [
        {
          sourceIndex: index,
          offerId: `offer-${index}`,
          supplierProductId: "supplier",
          genericId,
          genericLabel: "Nom générique fournisseur",
          label: "CAISSE DE 16 BARQUETTES 250G",
          packagingCode: "59",
          packagingLabel: "COLIS 16",
          packagingQuantity: "16",
          weight: "4",
          vatMultiplier: "1.055",
          origin: "FR",
          sourceFamily: "920",
          sourceUniverse: "46",
          sourceCreatedAt: null,
          sourceUpdatedAt: time,
          tariff: {
            base: "82",
            purchasePrice: "1.2",
            sellingPrice: "2.19",
            priceUnit: true,
            unavailable: null,
            complementary: null,
            orderDeadlines: [],
            deliveryDates: [],
          },
        },
      ],
    },
    link: {
      id: uuid(index + 20),
      storeId: product.storeId,
      genericId,
      productId: product.id,
      status: "ACTIVE",
      version: 1,
      createdBy: uuid(9),
      updatedBy: uuid(9),
      createdAt: time,
      updatedAt: time,
      basis: {
        catalogueSnapshotId: uuid(4),
        catalogueChecksum: hash,
        referenceDocumentId: uuid(5),
        referenceChecksum: hash,
        referenceParserVersion: "mercalys-reference-identities.v1",
        reference: {
          sourceIndex: index,
          itm8: "87005002",
          ean: "2800500200000",
          plu: null,
          pluSourceKind: "MISSING",
          label,
        },
        method: "MANUAL",
        reason: "Contrôlé",
      },
    },
  };
}
const preview = (text: string, p: Product = product) =>
  buildProcurementEnrichment(p, [source(text)]);
it.each([
  ["CAROTTE VRAC", "BULK", null],
  ["AIL BLANC FILET 250G", "PACKAGED", { quantity: "250", unit: "G" }],
  ["CAROTTE SACHET 2KG", "PACKAGED", { quantity: "2", unit: "KG" }],
  ["BANANE RUBAN 5 FRUITS BIO", "PACKAGED", { quantity: "5", unit: "PIECE" }],
  ["POMME FILET 1,50 KG", "PACKAGED", { quantity: "1.5", unit: "KG" }],
])(
  "proposes only explicitly described retail attributes: %s",
  (text, nature, packaging) => {
    const r = preview(text as string);
    expect(r.nature).toMatchObject({
      state: "PROPOSED",
      candidates: [{ value: nature }],
    });
    if (packaging)
      expect(r.packaging).toMatchObject({
        state: "PROPOSED",
        candidates: [{ value: packaging }],
      });
    else expect(r.packaging.candidates).toEqual([]);
    expect(r.salesUnit).toMatchObject({
      state: "UNKNOWN",
      candidates: [],
      reasons: ["ANALYTIC_UNIT_REQUIRES_REVIEW"],
    });
    expect(r.category.candidates).toEqual([]);
  },
);
it("does not copy supplier packaging, priceUnit, weight, nomenclature or labels into a retail fiche", () => {
  const r = preview("CHOU FLEUR PIECE BIO");
  expect(r.nature.state).toBe("UNKNOWN");
  expect(r.packaging.candidates).toEqual([]);
  expect(r.category.state).toBe("UNKNOWN");
  expect(r.salesUnit.state).toBe("UNKNOWN");
  expect(r.supplierOffers[0]!.offer).toMatchObject({
    packagingQuantity: "16",
    weight: "4",
    tariff: { priceUnit: true, purchasePrice: "1.2" },
  });
});
it.each([
  "BARQUETTE 2 X 250G",
  "SACHET 1KG+20% BIO",
  "FILET 1KG BONUS",
  "FILET 500G 1KG",
  "SACHET 0G",
  "TOMATE CERISE 250G",
  "TOMATE VRAC 500G",
  "FILET VRAC 250G",
])("holds ambiguous or unproven packaging for review: %s", (text) => {
  const r = preview(text);
  expect(r.packaging.state).toBe("REVIEW");
});
it("retains all provenance, merges identical evidence and flags conflicting linked labels independently of input order", () => {
  const a = source("AIL FILET 250G", 3),
    b = source("AIL FILET 500G", 6);
  a.catalogue.offers.push(...b.catalogue.offers);
  b.catalogue = a.catalogue;
  const one = buildProcurementEnrichment(product, [a, b]),
    two = buildProcurementEnrichment(product, [b, a]);
  expect(one).toEqual(two);
  expect(one.packaging).toMatchObject({
    state: "REVIEW",
    candidates: [
      { value: { quantity: "250" } },
      { value: { quantity: "500" } },
    ],
  });
  expect(one.sources).toHaveLength(2);
  expect(one.nature.candidates[0]!.evidence).toHaveLength(2);
  expect(one.nature.candidates[0]!.evidence[0]).toMatchObject({
    referenceDocumentId: uuid(5),
    sourceIndex: 3,
    excerpt: "FILET",
  });
});
it("preserves known values and never rewrites the analytic unit or source observations", () => {
  const existing = {
    ...product,
    category: "VEGETABLE" as const,
    nature: "BULK" as const,
    salesUnit: "KG" as const,
    isPetitPrix: false,
    packaging: {
      quantity: "1",
      unit: "KG" as const,
      sourceLabel: "Choix magasin",
    },
  };
  const s = source("AIL FILET 250G PETIT PRIX"),
    before = JSON.stringify({ existing, s });
  const r = buildProcurementEnrichment(existing, [s]);
  expect(r.category).toMatchObject({ state: "KEEP", current: "VEGETABLE" });
  expect(r.salesUnit).toMatchObject({
    state: "KEEP",
    current: "KG",
    candidates: [],
  });
  expect(r.nature.state).toBe("REVIEW");
  expect(r.packaging.state).toBe("REVIEW");
  expect(r.isPetitPrix.state).toBe("REVIEW");
  expect(JSON.stringify({ existing, s })).toBe(before);
});
it("keeps an identical confirmed packaging despite a different source-label spelling", () => {
  const r = preview("AIL FILET 250G", {
    ...product,
    packaging: { quantity: "250.0", unit: "G", sourceLabel: "Validé magasin" },
  });
  expect(r.packaging.state).toBe("KEEP");
  expect(r.packaging.current?.sourceLabel).toBe("Validé magasin");
});
it("requires positive complete Petit Prix evidence; absence is not false and a truncated name stays in review", () => {
  expect(preview("AIL FILET 250G PETIT PRIX").isPetitPrix).toMatchObject({
    state: "PROPOSED",
    candidates: [{ value: true }],
  });
  expect(preview("AIL FILET 250G PETIT PRI").isPetitPrix).toMatchObject({
    state: "REVIEW",
    candidates: [],
  });
  expect(preview("AIL FILET 250G").isPetitPrix).toMatchObject({
    state: "UNKNOWN",
    candidates: [],
    current: null,
  });
});
it("refuses missing, withdrawn, cross-store, stale or unrelated source evidence", () => {
  const s = source("CAROTTE VRAC");
  for (const bad of [
    { ...s, link: { ...s.link, status: "WITHDRAWN" as const } },
    { ...s, link: { ...s.link, storeId: uuid(99) } },
    { ...s, catalogueChecksum: "sha256:" + "b".repeat(64) },
    {
      ...s,
      catalogue: {
        ...s.catalogue,
        offers: s.catalogue.offers.map((o) => ({ ...o, genericId: "other" })),
      },
    },
  ])
    expect(() => buildProcurementEnrichment(product, [bad])).toThrow();
  expect(() => buildProcurementEnrichment(product, [])).toThrow();
  expect(() => buildProcurementEnrichment(product, [s, s])).toThrow();
  expect(() =>
    buildProcurementEnrichment({ ...product, deletedAt: time }, [s]),
  ).toThrow();
});
