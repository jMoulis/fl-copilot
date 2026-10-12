let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { it, expect } from "vitest";
import {
  searchCopilotProducts,
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
