let idCounter = 0;
const randomUUID = () =>
  `11111111-1111-4111-8111-${String(++idCounter).padStart(12, "0")}`;
import { expect, it } from "vitest";
import {
  procurementLinkIdentityKey,
  procurementLinkIdFromHash,
  referenceProductOwner,
  validateProcurementLinkChoice,
  validateProcurementLinkRevision,
  procurementLinkReviewSchema,
  procurementProductLinkSchema,
} from "./procurement-product-link";
import { productSchema, productIdentifierSchema } from "./index";
const storeId = randomUUID(),
  actor = randomUUID(),
  productId = randomUUID(),
  time = "2026-11-22T08:00:00.000Z";
const reference = {
  sourceIndex: 3,
  itm8: "0000087005002",
  ean: "2800500200000",
  plu: "5002",
  pluSourceKind: "INTEGER" as const,
  label: "CAROTTE VRAC",
};
const product = productSchema.parse({
  id: productId,
  storeId,
  label: "CAROTTE VRAC",
  category: "VEGETABLE",
  nature: "BULK",
  salesUnit: "KG",
  packaging: null,
  familyId: null,
  subfamilyId: null,
  status: "ACTIVE",
  version: 1,
  createdAt: time,
  updatedAt: time,
  deletedAt: null,
});
const identifiers = (
  [
    ["ITM8", "87005002"],
    ["EAN", reference.ean],
  ] as const
).map(([type, value]) =>
  productIdentifierSchema.parse({
    id: randomUUID(),
    storeId,
    productId,
    type,
    value,
    source: "MERCALYS",
    status: "VALIDATED",
    version: 1,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  }),
);
const catalog = { products: [product], identifiers, aliases: [] },
  offers = [{ genericId: "5002", offerId: "x", genericLabel: "CAROTTE VRAC" }];
const link = procurementProductLinkSchema.parse({
  id: randomUUID(),
  storeId,
  genericId: "5002",
  productId,
  status: "ACTIVE",
  basis: {
    catalogueSnapshotId: randomUUID(),
    catalogueChecksum: "sha256:" + "a".repeat(64),
    referenceDocumentId: randomUUID(),
    referenceChecksum: "sha256:" + "b".repeat(64),
    referenceParserVersion: "mercalys-reference-identities.v1",
    reference,
    method: "EXPLICIT_PLU",
    reason: null,
  },
  version: 1,
  createdBy: actor,
  updatedBy: actor,
  createdAt: time,
  updatedAt: time,
});
it("requires current unique validated ITM and EAN ownership by the same active Product", () => {
  expect(referenceProductOwner(reference, catalog, storeId)).toBe(productId);
  for (const mutation of [
    { ...catalog, identifiers: [identifiers[0]!] },
    {
      ...catalog,
      identifiers: [
        identifiers[0]!,
        { ...identifiers[1]!, productId: randomUUID() },
      ],
    },
    {
      ...catalog,
      identifiers: [
        ...identifiers,
        { ...identifiers[0]!, id: randomUUID(), productId: randomUUID() },
      ],
    },
    { ...catalog, products: [{ ...product, status: "INACTIVE" as const }] },
  ])
    expect(referenceProductOwner(reference, mutation, storeId)).toBeNull();
});
it("holds contradictory PLU evidence for manual review despite identical labels", () => {
  const contradictory = { ...reference, plu: "7349" };
  const l = {
    ...link,
    basis: {
      ...link.basis,
      reference: contradictory,
      method: "ITM_CANDIDATE" as const,
    },
  };
  expect(() =>
    validateProcurementLinkChoice(l, offers, [contradictory], catalog),
  ).toThrow("REVIEW_REQUIRED");
  const manual = procurementProductLinkSchema.parse({
    ...l,
    basis: { ...l.basis, method: "MANUAL", reason: "Référence contrôlée" },
  });
  expect(() =>
    validateProcurementLinkChoice(manual, offers, [contradictory], catalog),
  ).not.toThrow();
  expect(() =>
    validateProcurementLinkChoice(
      { ...manual, productId: randomUUID() },
      offers,
      [contradictory],
      catalog,
    ),
  ).toThrow();
});
it("keeps creation identity immutable and withdrawal evidence unchanged", () => {
  expect(() => validateProcurementLinkRevision(link, null)).not.toThrow();
  const next = { ...link, version: 2, status: "WITHDRAWN" as const };
  expect(() => validateProcurementLinkRevision(next, link)).not.toThrow();
  expect(() =>
    validateProcurementLinkRevision({ ...next, productId: randomUUID() }, link),
  ).toThrow();
  expect(() =>
    validateProcurementLinkRevision({ ...next, createdBy: randomUUID() }, link),
  ).toThrow();
  expect(() =>
    procurementLinkReviewSchema.parse({
      id: randomUUID(),
      storeId,
      actorId: actor,
      version: 1,
      createdAt: time,
      decisions: [
        { link, expectedVersion: null },
        { link, expectedVersion: null },
      ],
    }),
  ).toThrow();
});
it("creates the same stable UUID on both adapters without normalizing generic leading zeros", () => {
  const hash = "sha256:" + "1234567890abcdef".repeat(4);
  expect(procurementLinkIdFromHash(hash)).toBe(
    "12345678-90ab-8def-9234-567890abcdef",
  );
  expect(procurementLinkIdentityKey(storeId, "005002")).not.toBe(
    procurementLinkIdentityKey(storeId, "5002"),
  );
  expect(procurementLinkIdentityKey(storeId.toUpperCase(), "5002")).toBe(
    procurementLinkIdentityKey(storeId, "5002"),
  );
});
