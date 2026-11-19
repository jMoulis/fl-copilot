import { describe, expect, it } from "vitest";
import {
  matchProduct as matchSingleProduct,
  prepareProductMatcher,
  prepareMercalysProductMatcher,
  prepareProductRematcher,
  productMatchingSignature,
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

describe.each(["single", "prepared"])("product matching (%s)", (mode) => {
  const matchProduct: typeof matchSingleProduct = (request, input, config) =>
    mode === "single"
      ? matchSingleProduct(request, input, config)
      : prepareProductMatcher(request.storeId, input, config)(request);
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

it("reuses one catalogue for repeated requests and refreshes after catalogue changes", () => {
  const input = catalog();
  const match = prepareProductMatcher(storeId, input);
  for (const label of [
    "Poire conférence vrac",
    "Pomme gala vrac",
    "Poir conference",
    "Inconnu",
  ]) {
    expect(match({ storeId, label })).toEqual(
      matchSingleProduct({ storeId, label }, input),
    );
  }
  expect(() =>
    match({ storeId: otherStoreId, label: "Pomme gala vrac" }),
  ).toThrow("PRODUCT_MATCH_STORE_MISMATCH");
  const next = catalog({ products: [product(pearId, "Pomme gala vrac")] });
  expect(
    prepareProductMatcher(storeId, next)({ storeId, label: "Pomme gala vrac" })
      .matchedProductId,
  ).toBe(pearId);
  expect(match({ storeId, label: "Pomme gala vrac" }).matchedProductId).toBe(
    appleId,
  );
});

it("incremental matching preserves complete search across additions, edits, removals and identity conflicts", () => {
  const ids = Array.from(
    { length: 12 },
    (_, i) => `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  let before = catalog({
    products: ids.slice(0, 10).map((id, i) => product(id, `Pomme gala ${i}`)),
    identifiers: [identifier(pearId, ids[0]!, "ITM8", "0001")],
    aliases: [alias(appleId, ids[1]!, "GALA")],
  });
  const requests = [
    "POMME GALA",
    "POMME GALA 1",
    "GALA",
    "POMME ROUGE",
    "RADIS",
    "",
  ].flatMap((label) => [
    { storeId, label: label || null },
    {
      storeId,
      label: label || null,
      identifiers: [{ type: "ITM8" as const, value: "0001" }],
    },
  ]);
  const edits: ((c: ProductMatchCatalog) => ProductMatchCatalog)[] = [
    (c) => ({
      ...c,
      products: [...c.products, product(ids[10]!, "Pomme gala")],
    }),
    (c) => ({
      ...c,
      identifiers: [
        ...c.identifiers,
        identifier(ids[11]!, ids[10]!, "ITM8", "0001"),
      ],
    }),
    (c) => ({
      ...c,
      aliases: [...c.aliases, alias(ids[11]!, ids[10]!, "GALA")],
    }),
    (c) => ({
      ...c,
      products: c.products.map((p, i) =>
        i === 0 ? { ...p, status: "INACTIVE" as const } : p,
      ),
    }),
    (c) => ({
      ...c,
      products: c.products.map((p, i) =>
        i === 1 ? { ...p, label: "Radis rose" } : p,
      ),
    }),
    (c) => ({ ...c, products: c.products.filter((p) => p.id !== ids[10]) }),
    (c) => ({ ...c, identifiers: [], aliases: [] }),
    (c) => ({
      ...c,
      products: [...c.products]
        .reverse()
        .map((p) => ({ ...p, version: p.version + 1 })),
    }),
  ];
  for (const edit of edits) {
    const after = edit(before);
    const rematch = prepareProductRematcher(storeId, before, after);
    for (const request of requests)
      expect(rematch(request, matchSingleProduct(request, before))).toEqual(
        matchSingleProduct(request, after),
      );
    before = after;
  }
});
it("matching signature ignores synchronization metadata and order but tracks identity changes", () => {
  const before = catalog();
  expect(productMatchingSignature(storeId, before)).toBe(
    productMatchingSignature(storeId, {
      ...before,
      products: [...before.products]
        .reverse()
        .map((p) => ({ ...p, version: 99, updatedAt: "2026-11-18T12:00:00Z" })),
    }),
  );
  expect(productMatchingSignature(storeId, before)).not.toBe(
    productMatchingSignature(storeId, {
      ...before,
      products: before.products.map((p) => ({ ...p, status: "INACTIVE" })),
    }),
  );
});

it("keeps fuzzy ties and refills truncated rankings when a retained candidate changes", () => {
  const products = Array.from({ length: 9 }, (_, i) =>
    product(
      `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      `TOMATE CERISE ${i} KG`,
    ),
  );
  const before = catalog({ products });
  const request = { storeId, label: "TOMATE CERISE KG" };
  const previous = matchSingleProduct(request, before);
  expect(previous.candidates).toHaveLength(5);
  const retained = previous.candidates[0]!.productId;
  for (const after of [
    { ...before, products: products.filter((p) => p.id !== retained) },
    {
      ...before,
      products: products.map((p) =>
        p.id === retained ? { ...p, label: "CHOU ROUGE" } : p,
      ),
    },
    {
      ...before,
      products: [...products, product(appleId, "TOMATE CERISE 10 KG")],
    },
    {
      ...before,
      aliases: [alias(pearId, products[8]!.id, "TOMATE CERISE KG")],
    },
  ]) {
    expect(
      prepareProductRematcher(storeId, before, after)(request, previous),
    ).toEqual(matchSingleProduct(request, after));
  }
});

describe("Mercalys code identity", () => {
  it("allows a new code even for an identical label, while preserving the generic matcher", () => {
    const c = catalog({ identifiers: [] });
    const request = {
      storeId,
      identifiers: [{ type: "ITM8" as const, value: "000999" }],
      label: c.products[0]!.label,
    };
    expect(prepareMercalysProductMatcher(storeId, c)(request).state).toBe(
      "NO_MATCH",
    );
    expect(prepareProductMatcher(storeId, c)(request).state).toBe("AUTO_MATCH");
    expect(
      prepareMercalysProductMatcher(storeId, c)({ ...request, identifiers: [] })
        .state,
    ).toBe("REVIEW");
  });
  it("reuses either code but preserves conflicting and inactive ownership", () => {
    const c = catalog({
      identifiers: [
        identifier("a", pearId, "ITM8", "0001"),
        identifier("b", appleId, "EAN", "0002"),
      ],
    });
    const req = {
      storeId,
      identifiers: [
        { type: "ITM8" as const, value: "0001" },
        { type: "EAN" as const, value: "new" },
      ],
      label: "Autre nom",
    };
    expect(
      prepareMercalysProductMatcher(storeId, c)(req).matchedProductId,
    ).toBe(pearId);
    expect(
      prepareMercalysProductMatcher(
        storeId,
        c,
      )({
        ...req,
        identifiers: [req.identifiers[0]!, { type: "EAN", value: "0002" }],
      }).conflict?.kind,
    ).toBe("IDENTIFIER_CONFLICT");
    const retired = {
      ...c,
      products: c.products.map((p) =>
        p.id === pearId ? { ...p, status: "INACTIVE" as const } : p,
      ),
    };
    expect(prepareMercalysProductMatcher(storeId, retired)(req)).toMatchObject({
      state: "AMBIGUOUS",
      method: "EXACT_IDENTIFIER",
      matchedProductId: null,
    });
  });
});
