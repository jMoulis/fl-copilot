import { expect, it } from "vitest";
import {
  mercalysProductTargetBlocker,
  searchMercalysProductTargets,
} from "./mercalys-product-target";
import { copilotImportResolutionChoiceSchema } from "./copilot-import-assistance";
import type { ProductMatchCatalog } from "./product-matching";
import {
  normalizeProductLabel,
  type Product,
  type ProductIdentifier,
  type ProductAlias,
} from "./products";
let sequence = 0;
const randomUUID = () =>
  `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const store = randomUUID(),
  other = randomUUID(),
  time = "2026-10-18T10:00:00.000Z";
const product = (label: string, patch: Partial<Product> = {}): Product => ({
  id: randomUUID(),
  storeId: store,
  label,
  category: "FRUIT",
  nature: "BULK",
  salesUnit: "KG",
  status: "ACTIVE",
  version: 1,
  createdAt: time,
  updatedAt: time,
  ...patch,
});
const id = (
  productId: string,
  value: string,
  patch: Partial<ProductIdentifier> = {},
): ProductIdentifier => ({
  id: randomUUID(),
  storeId: store,
  productId,
  value,
  type: "ITM8",
  source: "USER",
  status: "VALIDATED",
  version: 1,
  createdAt: time,
  updatedAt: time,
  ...patch,
});
const alias = (
  productId: string,
  label: string,
  patch: Partial<ProductAlias> = {},
): ProductAlias => ({
  id: randomUUID(),
  storeId: store,
  productId,
  alias: label,
  normalizedAlias: normalizeProductLabel(label),
  source: "USER",
  status: "VALIDATED",
  version: 1,
  createdAt: time,
  updatedAt: time,
  ...patch,
});
it("searches names, validated aliases and string codes without crossing stores or reviving inactive/deleted products", () => {
  const a = product("Poire Conférence"),
    b = product("Melon jaune"),
    foreign = product("Conférence", { storeId: other });
  const catalog: ProductMatchCatalog = {
    products: [
      a,
      b,
      foreign,
      product("Conférence", { status: "INACTIVE" }),
      product("Conférence", { deletedAt: time }),
    ],
    identifiers: [id(a.id, "00001234"), id(b.id, "1234")],
    aliases: [
      alias(b.id, "Melon d’Espagne"),
      alias(b.id, "Rejeté", { status: "REJECTED" }),
    ],
  };
  expect(
    searchMercalysProductTargets(store, catalog, "poire conference").products,
  ).toEqual([a]);
  expect(
    searchMercalysProductTargets(store, catalog, "00001234").products,
  ).toEqual([a]);
  expect(
    searchMercalysProductTargets(store, catalog, "espagne").products,
  ).toEqual([b]);
  expect(searchMercalysProductTargets(store, catalog, "rejeté").total).toBe(0);
  expect(searchMercalysProductTargets(store, catalog, "  ").total).toBe(0);
  expect(catalog.identifiers[0]!.value).toBe("00001234");
});
it("bounds displayed search matches while keeping the complete count", () => {
  const catalog = {
    products: Array.from({ length: 35 }, (_, n) =>
      product(`Article ${n.toString().padStart(2, "0")}`),
    ).reverse(),
    identifiers: [],
    aliases: [],
  };
  const result = searchMercalysProductTargets(store, catalog, "article");
  expect(result.total).toBe(35);
  expect(result.products).toHaveLength(20);
  expect(result.products[0]?.label).toBe("Article 00");
  expect(result.products[19]?.label).toBe("Article 19");
});
it("allows explicit non-similar targets but never moves codes or reactivates unvalidated identities", () => {
  const a = product("Melon"),
    b = product("Tomate", { status: "INACTIVE" }),
    source = {
      label: "SOURCE",
      identifiers: [{ type: "ITM8" as const, value: "0001" }],
    };
  const catalog: ProductMatchCatalog = {
    products: [a, b],
    identifiers: [],
    aliases: [],
  };
  expect(mercalysProductTargetBlocker(store, source, a.id, catalog)).toBeNull();
  expect(mercalysProductTargetBlocker(other, source, a.id, catalog)).toBe(
    "PRODUCT_UNAVAILABLE",
  );
  expect(mercalysProductTargetBlocker(store, source, b.id, catalog)).toBe(
    "PRODUCT_UNAVAILABLE",
  );
  expect(
    mercalysProductTargetBlocker(store, source, a.id, {
      ...catalog,
      identifiers: [id(b.id, "0001")],
    }),
  ).toBe("IDENTIFIER_OWNED");
  expect(
    mercalysProductTargetBlocker(store, source, a.id, {
      ...catalog,
      identifiers: [id(a.id, "0001", { status: "TO_REVIEW" })],
    }),
  ).toBe("IDENTITY_REVIEW_REQUIRED");
  expect(
    mercalysProductTargetBlocker(store, source, a.id, {
      ...catalog,
      identifiers: [id(a.id, "0001", { deletedAt: time })],
    }),
  ).toBeNull();
});
it.each(["REJECTED", "TO_REVIEW"] as const)(
  "does not erase a prior alias decision (%s)",
  (status) => {
    const a = product("Melon"),
      source = { label: "NOM SOURCE", identifiers: [] };
    expect(
      mercalysProductTargetBlocker(store, source, a.id, {
        products: [a],
        identifiers: [],
        aliases: [alias(a.id, source.label, { status })],
      }),
    ).toBe("ALIAS_REVIEW_REQUIRED");
  },
);
it("validates only a native selection, without accepting extra mutation or scope fields", () => {
  const choice = {
    resolutionKey: "ITM8:0001",
    productId: randomUUID(),
    catalogueSelection: true,
  };
  expect(copilotImportResolutionChoiceSchema.safeParse(choice).success).toBe(
    true,
  );
  expect(
    copilotImportResolutionChoiceSchema.safeParse({ ...choice, storeId: other })
      .success,
  ).toBe(false);
  expect(
    copilotImportResolutionChoiceSchema.safeParse({
      ...choice,
      productId: null,
    }).success,
  ).toBe(false);
  expect(
    copilotImportResolutionChoiceSchema.safeParse({
      ...choice,
      catalogueSelection: false,
    }).success,
  ).toBe(false);
});
