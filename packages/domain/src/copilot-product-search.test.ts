let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { it, expect } from "vitest";
import {
  searchCopilotProducts,
  copilotProductSearchResultSchema,
  copilotProductSearchInputSchema,
} from "./copilot-product-search";
import type { Product } from "./products";
function fixture() {
  const storeId = randomUUID(),
    product: Product = {
      id: randomUUID(),
      storeId,
      label: "POIRE CONFÉRENCE VRAC",
      category: "FRUIT",
      nature: "BULK",
      salesUnit: "KG",
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-10-12T12:00:00Z",
      updatedAt: "2026-10-12T12:00:00Z",
      deletedAt: null,
    };
  return { storeId, product };
}
it("offers exact normalized identity and literal terms without silently choosing a candidate", () => {
  const f = fixture(),
    catalog = {
      products: [
        f.product,
        { ...f.product, id: randomUUID(), label: "POIRE WILLIAMS VRAC" },
        { ...f.product, id: randomUUID(), storeId: randomUUID() },
      ],
      aliases: [],
      identifiers: [],
    };
  expect(
    searchCopilotProducts(
      f.storeId,
      { label: "poire conference vrac", identifiers: [] },
      catalog,
    ).matchedProductId,
  ).toBe(f.product.id);
  const r = searchCopilotProducts(
    f.storeId,
    { label: "poire", identifiers: [] },
    catalog,
  );
  expect(r.state).toBe("AMBIGUOUS");
  expect(r.matchedProductId).toBeNull();
  expect(r.candidates).toHaveLength(2);
  expect(r.candidates.every((c) => c.basis === "LABEL_TERMS")).toBe(true);
  const single = searchCopilotProducts(
    f.storeId,
    { label: "conference", identifiers: [] },
    { ...catalog, products: [f.product] },
  );
  expect(single.state).toBe("REVIEW");
  expect(single.matchedProductId).toBeNull();
});
it("reports complete ambiguity beyond the visible five candidates and rejects empty lookup", () => {
  const f = fixture(),
    products = Array.from({ length: 6 }, (_, i) => ({
      ...f.product,
      id: randomUUID(),
      label: `POIRE ${i} VRAC`,
    }));
  const r = searchCopilotProducts(
    f.storeId,
    { label: "poire", identifiers: [] },
    { products, aliases: [], identifiers: [] },
  );
  expect(r.candidates).toHaveLength(5);
  expect(r.candidateCount).toBe(6);
  expect(r.hasMoreCandidates).toBe(true);
  expect(r.matchedProductId).toBeNull();
  expect(() =>
    copilotProductSearchInputSchema.parse({ label: null, identifiers: [] }),
  ).toThrow();
});

it("keeps legacy lookup code coverage unknown and validates explicit complete or unavailable code lists", () => {
  const f = fixture();
  const found = searchCopilotProducts(
    f.storeId,
    { label: f.product.label, identifiers: [] },
    { products: [f.product], identifiers: [], aliases: [] },
  );
  const result = { status: "COMPLETE_CATALOG", ...found, evidence: [] };
  expect(
    copilotProductSearchResultSchema.parse(result).candidates[0],
  ).not.toHaveProperty("identifiersComplete");
  const codes = (patch: object) => ({
    ...result,
    candidates: [{ ...found.candidates[0], ...patch }],
  });
  expect(
    copilotProductSearchResultSchema.parse(
      codes({
        identifiers: [{ type: "PLU", value: "000123" }],
        identifiersComplete: true,
      }),
    ).candidates[0]?.identifiers?.[0]?.value,
  ).toBe("000123");
  expect(
    copilotProductSearchResultSchema.safeParse(
      codes({ identifiers: [], identifiersComplete: true }),
    ).success,
  ).toBe(true);
  expect(
    copilotProductSearchResultSchema.safeParse(
      codes({ identifiers: [], identifiersComplete: false }),
    ).success,
  ).toBe(true);
  for (const patch of [
    { identifiers: [] },
    { identifiersComplete: true },
    {
      identifiers: [{ type: "PLU", value: "000123" }],
      identifiersComplete: false,
    },
    {
      identifiers: Array.from({ length: 21 }, () => ({
        type: "PLU",
        value: "000123",
      })),
      identifiersComplete: true,
    },
  ])
    expect(
      copilotProductSearchResultSchema.safeParse(codes(patch)).success,
    ).toBe(false);
});
