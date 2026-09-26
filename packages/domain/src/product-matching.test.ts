import { describe, expect, it } from "vitest";
import {
  matchProduct,
  type ProductMatchCatalog,
  type ProductMatcherConfig,
} from "./product-matching";
import type { Product, ProductAlias, ProductIdentifier } from "./products";

const storeId = "10000000-0000-4000-8000-000000000000";
const otherStoreId = "20000000-0000-4000-8000-000000000000";
const pearId = "30000000-0000-4000-8000-000000000000";
const appleId = "40000000-0000-4000-8000-000000000000";
const timestamp = "2026-09-27T08:00:00.000Z";

function product(
  id: string,
  label: string,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    storeId,
    label,
    category: "FRUIT",
    nature: "BULK",
    salesUnit: "KG",
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function identifier(
  id: string,
  productId: string,
  type: ProductIdentifier["type"],
  value: string,
  overrides: Partial<ProductIdentifier> = {},
): ProductIdentifier {
  return {
    id,
    storeId,
    productId,
    type,
    value,
    source: "MERCALYS",
    status: "VALIDATED",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function alias(
  id: string,
  productId: string,
  value: string,
  overrides: Partial<ProductAlias> = {},
): ProductAlias {
  return {
    id,
    storeId,
    productId,
    alias: value,
    normalizedAlias: value,
    source: "MERCALYS",
    status: "VALIDATED",
    confidence: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function catalog(
  overrides: Partial<ProductMatchCatalog> = {},
): ProductMatchCatalog {
  return {
    products: [
      product(pearId, "Poire conférence vrac"),
      product(appleId, "Pomme gala vrac"),
    ],
    identifiers: [],
    aliases: [],
    ...overrides,
  };
}

describe("product matching", () => {
  it("gives an exact validated identifier precedence over a contradictory label", () => {
    const result = matchProduct(
      {
        storeId,
        identifiers: [{ type: "EAN", value: "0000087003017" }],
        label: "Pomme gala vrac",
      },
      catalog({
        identifiers: [
          identifier(
            "50000000-0000-4000-8000-000000000000",
            pearId,
            "EAN",
            "0000087003017",
          ),
        ],
      }),
    );

    expect(result).toMatchObject({
      state: "AUTO_MATCH",
      matchedProductId: pearId,
      method: "EXACT_IDENTIFIER",
      conflict: null,
    });
  });

  it("blocks auto-match when ITM8 and EAN resolve to different products", () => {
    const result = matchProduct(
      {
        storeId,
        identifiers: [
          { type: "ITM8", value: "01234567" },
          { type: "EAN", value: "0000087003017" },
        ],
      },
      catalog({
        identifiers: [
          identifier(
            "50000000-0000-4000-8000-000000000001",
            pearId,
            "ITM8",
            "01234567",
          ),
          identifier(
            "50000000-0000-4000-8000-000000000002",
            appleId,
            "EAN",
            "0000087003017",
          ),
        ],
      }),
    );

    expect(result.state).toBe("AMBIGUOUS");
    expect(result.matchedProductId).toBeNull();
    expect(result.conflict).toEqual({
      kind: "IDENTIFIER_CONFLICT",
      identifierTypes: ["EAN", "ITM8"],
      productIds: [pearId, appleId],
    });
  });

  it("preserves leading zeroes during exact identifier matching", () => {
    const products = catalog({
      identifiers: [
        identifier(
          "50000000-0000-4000-8000-000000000003",
          pearId,
          "EAN",
          "0000087003017",
        ),
      ],
    });

    expect(
      matchProduct(
        {
          storeId,
          identifiers: [{ type: "EAN", value: "87003017" }],
        },
        products,
      ).state,
    ).toBe("NO_MATCH");
    expect(
      matchProduct(
        {
          storeId,
          identifiers: [{ type: "EAN", value: "0000087003017" }],
        },
        products,
      ).matchedProductId,
    ).toBe(pearId);
  });

  it("uses only validated aliases from the requested active store", () => {
    const result = matchProduct(
      { storeId, label: "POIRE CONF VRAC" },
      catalog({
        aliases: [
          alias(
            "60000000-0000-4000-8000-000000000001",
            appleId,
            "POIRE CONF VRAC",
            { status: "TO_REVIEW" },
          ),
          alias(
            "60000000-0000-4000-8000-000000000002",
            pearId,
            "POIRE CONF VRAC",
          ),
          alias(
            "60000000-0000-4000-8000-000000000003",
            appleId,
            "POIRE CONF VRAC",
            { storeId: otherStoreId },
          ),
        ],
      }),
    );

    expect(result).toMatchObject({
      state: "AUTO_MATCH",
      matchedProductId: pearId,
      method: "VALIDATED_ALIAS",
    });
  });

  it("matches one canonical label after deterministic normalization", () => {
    const result = matchProduct(
      { storeId, label: "  POIRE conférence — vrac " },
      catalog(),
    );

    expect(result).toMatchObject({
      state: "AUTO_MATCH",
      matchedProductId: pearId,
      method: "CANONICAL_LABEL",
    });
  });

  it("does not choose between duplicate exact aliases", () => {
    const result = matchProduct(
      { storeId, label: "POIRE CONF VRAC" },
      catalog({
        aliases: [
          alias(
            "60000000-0000-4000-8000-000000000004",
            pearId,
            "POIRE CONF VRAC",
          ),
          alias(
            "60000000-0000-4000-8000-000000000005",
            appleId,
            "POIRE CONF VRAC",
          ),
        ],
      }),
    );

    expect(result.state).toBe("AMBIGUOUS");
    expect(result.matchedProductId).toBeNull();
    expect(result.candidates.map(({ productId }) => productId)).toEqual([
      pearId,
      appleId,
    ]);
  });

  it("returns fuzzy candidates for review without asserting product truth", () => {
    const config: ProductMatcherConfig = {
      version: "product-matcher-test-v2",
      fuzzyCandidateThreshold: 0.4,
      fuzzyReviewThreshold: 0.7,
      fuzzyAmbiguityDelta: 0.05,
      maxCandidates: 3,
    };
    const result = matchProduct(
      { storeId, label: "POIRE CONFERANCE VRA" },
      catalog(),
      config,
    );

    expect(result).toMatchObject({
      engineVersion: "product-matcher-test-v2",
      state: "REVIEW",
      matchedProductId: null,
      method: "FUZZY_LABEL",
    });
    expect(result.candidates[0]).toMatchObject({
      productId: pearId,
      identifierMatch: false,
    });
  });

  it("excludes inactive, review-only and deleted products", () => {
    const result = matchProduct(
      { storeId, label: "POIRE CONFERENCE VRAC" },
      catalog({
        products: [
          product(pearId, "Poire conférence vrac", { status: "INACTIVE" }),
          product(appleId, "Poire conférence vrac", { status: "TO_REVIEW" }),
          product(
            "70000000-0000-4000-8000-000000000000",
            "Poire conférence vrac",
            { deletedAt: timestamp },
          ),
        ],
      }),
    );

    expect(result.state).toBe("NO_MATCH");
  });
});
