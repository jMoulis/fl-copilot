import { z } from "zod";
import {
  normalizeProductLabel,
  productIdentifierTypeSchema,
  type Product,
  type ProductAlias,
  type ProductIdentifier,
} from "./products";

export const productMatchStateSchema = z.enum([
  "AUTO_MATCH",
  "REVIEW",
  "AMBIGUOUS",
  "NO_MATCH",
]);

export const productMatchMethodSchema = z.enum([
  "EXACT_IDENTIFIER",
  "VALIDATED_ALIAS",
  "CANONICAL_LABEL",
  "FUZZY_LABEL",
]);

export const productMatchCandidateSchema = z.object({
  productId: z.string().uuid(),
  score: z.number().min(0).max(1),
  method: productMatchMethodSchema,
  reasons: z.array(z.string().min(1)),
  identifierMatch: z.boolean().optional(),
  labelSimilarity: z.number().min(0).max(1).nullable().optional(),
});

export const productMatchConflictSchema = z.object({
  kind: z.literal("IDENTIFIER_CONFLICT"),
  identifierTypes: z.array(productIdentifierTypeSchema),
  productIds: z.array(z.string().uuid()),
});

export const productMatchResultSchema = z.object({
  engineVersion: z.string().min(1),
  state: productMatchStateSchema,
  matchedProductId: z.string().uuid().nullable(),
  method: productMatchMethodSchema.nullable(),
  candidates: z.array(productMatchCandidateSchema),
  conflict: productMatchConflictSchema.nullable(),
});

export const productMatchRequestSchema = z.object({
  storeId: z.string().uuid(),
  identifiers: z
    .array(
      z.object({
        type: productIdentifierTypeSchema,
        value: z.string().trim().min(1).max(80),
      }),
    )
    .default([]),
  label: z.string().trim().min(1).max(240).nullable().optional(),
});

export const productMatcherConfigSchema = z
  .object({
    version: z.string().min(1),
    fuzzyCandidateThreshold: z.number().min(0).max(1),
    fuzzyReviewThreshold: z.number().min(0).max(1),
    fuzzyAmbiguityDelta: z.number().min(0).max(1),
    maxCandidates: z.number().int().positive(),
  })
  .refine(
    (config) => config.fuzzyCandidateThreshold <= config.fuzzyReviewThreshold,
    "The fuzzy candidate threshold must not exceed the review threshold.",
  );

export const defaultProductMatcherConfig = {
  version: "product-matcher-v1",
  fuzzyCandidateThreshold: 0.55,
  fuzzyReviewThreshold: 0.8,
  fuzzyAmbiguityDelta: 0.05,
  maxCandidates: 5,
} as const;

export type ProductMatchState = z.infer<typeof productMatchStateSchema>;
export type ProductMatchMethod = z.infer<typeof productMatchMethodSchema>;
export type ProductMatchCandidate = z.infer<typeof productMatchCandidateSchema>;
export type ProductMatchResult = z.infer<typeof productMatchResultSchema>;
export type ProductMatchRequest = z.input<typeof productMatchRequestSchema>;
export type ProductMatcherConfig = z.infer<typeof productMatcherConfigSchema>;

export type ProductMatchCatalog = {
  products: readonly Product[];
  identifiers: readonly ProductIdentifier[];
  aliases: readonly ProductAlias[];
};

type ActiveCatalog = {
  products: Map<string, Product>;
  identifiers: ProductIdentifier[];
  aliases: ProductAlias[];
  identifiersByValue: Map<string, string[]>;
  aliasesByProduct: Map<string, ProductAlias[]>;
  canonicalLabels: Map<string, string>;
  idsByLabel: Map<string, string[]>;
  idsByAlias: Map<string, string[]>;
};

export function matchProduct(
  requestInput: ProductMatchRequest,
  catalog: ProductMatchCatalog,
  configInput: ProductMatcherConfig = defaultProductMatcherConfig,
): ProductMatchResult {
  const request = productMatchRequestSchema.parse(requestInput);
  const config = productMatcherConfigSchema.parse(configInput);
  const activeCatalog = getActiveCatalog(request.storeId, catalog);

  return matchActiveProduct(request, activeCatalog, config);
}

/** Snapshot for one validation run; create again after catalogue mutations. */
export function prepareProductMatcher(
  storeId: string,
  catalog: ProductMatchCatalog,
  configInput: ProductMatcherConfig = defaultProductMatcherConfig,
) {
  const config = productMatcherConfigSchema.parse(configInput);
  const activeCatalog = getActiveCatalog(storeId, catalog);
  return (requestInput: ProductMatchRequest): ProductMatchResult => {
    const request = productMatchRequestSchema.parse(requestInput);
    if (request.storeId !== storeId)
      throw Error("PRODUCT_MATCH_STORE_MISMATCH");
    return matchActiveProduct(request, activeCatalog, config);
  };
}

/** Mercalys identity is defined by supplied codes, never label resemblance.
 * Retired products still own their codes and must not be recreated silently.
 */
export function prepareMercalysProductMatcher(
  storeId: string,
  catalog: ProductMatchCatalog,
) {
  const products = new Map(
    catalog.products
      .filter((p) => p.storeId === storeId && !p.deletedAt)
      .map((p) => [p.id, p]),
  );
  const owners = new Map<string, Set<string>>();
  const unvalidated = new Set<string>();
  for (const code of catalog.identifiers) {
    if (
      code.storeId !== storeId ||
      code.deletedAt ||
      !products.has(code.productId)
    )
      continue;
    const key = JSON.stringify([code.type, code.value]);
    if (code.status !== "VALIDATED") unvalidated.add(key);
    const ids = owners.get(key) ?? new Set<string>();
    ids.add(code.productId);
    owners.set(key, ids);
  }
  const fallback = prepareProductMatcher(storeId, catalog);
  return (input: ProductMatchRequest): ProductMatchResult => {
    const request = productMatchRequestSchema.parse(input);
    if (request.storeId !== storeId)
      throw Error("PRODUCT_MATCH_STORE_MISMATCH");
    if (!request.identifiers.length) {
      const result = fallback(request);
      return result.state === "AUTO_MATCH" &&
        result.method !== "VALIDATED_ALIAS"
        ? { ...result, state: "REVIEW", matchedProductId: null }
        : result;
    }
    const ids = [
      ...new Set(
        request.identifiers.flatMap((code) => [
          ...(owners.get(JSON.stringify([code.type, code.value])) ?? []),
        ]),
      ),
    ].sort();
    if (!ids.length) return noMatch("mercalys-codes-v1");
    const candidates = ids.map((productId) => ({
      productId,
      score: 1,
      method: "EXACT_IDENTIFIER" as const,
      reasons: [
        products.get(productId)?.status === "ACTIVE"
          ? "EXACT_CODE"
          : "INACTIVE_CODE_OWNER",
      ],
      identifierMatch: true,
      labelSimilarity: null,
    }));
    const validated = request.identifiers.every(
      (code) => !unvalidated.has(JSON.stringify([code.type, code.value])),
    );
    const automatic =
      ids.length === 1 &&
      products.get(ids[0]!)?.status === "ACTIVE" &&
      validated;
    return {
      engineVersion: "mercalys-codes-v1",
      state: automatic ? "AUTO_MATCH" : "AMBIGUOUS",
      matchedProductId: automatic ? ids[0]! : null,
      method: "EXACT_IDENTIFIER",
      candidates,
      conflict:
        ids.length > 1
          ? {
              kind: "IDENTIFIER_CONFLICT",
              productIds: ids,
              identifierTypes: [
                ...new Set(request.identifiers.map((i) => i.type)),
              ].sort(),
            }
          : null,
    };
  };
}

/** Only inputs consumed by the matcher; sync versions and row order are irrelevant. */
export function productMatchingSignature(
  storeId: string,
  catalog: ProductMatchCatalog,
) {
  return JSON.stringify(
    [...matchingProductSignatures(getActiveCatalog(storeId, catalog))].sort(),
  );
}

function matchingProductSignatures(catalog: ActiveCatalog) {
  const identifiers = new Map<string, string[]>();
  for (const value of catalog.identifiers) {
    const entries = identifiers.get(value.productId) ?? [];
    entries.push(JSON.stringify([value.type, value.value]));
    identifiers.set(value.productId, entries);
  }
  return new Map(
    [...catalog.products.keys()].map((id) => [
      id,
      JSON.stringify([
        catalog.canonicalLabels.get(id),
        [...new Set(identifiers.get(id) ?? [])].sort(),
        [
          ...new Set(
            (catalog.aliasesByProduct.get(id) ?? []).map(
              (alias) => alias.normalizedAlias,
            ),
          ),
        ].sort(),
      ]),
    ]),
  );
}

/** Reuse a previous result only against the catalogue that produced it.
 * A changed retained candidate requires a full search (a sixth candidate may
 * enter). Otherwise unchanged discarded candidates cannot outrank the retained
 * ones; evaluating those plus changed products preserves every matching tier.
 */
export function prepareProductRematcher(
  storeId: string,
  before: ProductMatchCatalog,
  after: ProductMatchCatalog,
) {
  const prior = matchingProductSignatures(getActiveCatalog(storeId, before));
  const active = getActiveCatalog(storeId, after);
  const next = matchingProductSignatures(active);
  const changed = new Set(
    [...prior.keys(), ...next.keys()].filter(
      (id) => prior.get(id) !== next.get(id),
    ),
  );
  const changedCatalog: ActiveCatalog = {
    ...active,
    products: new Map([...active.products].filter(([id]) => changed.has(id))),
  };
  return (
    requestInput: ProductMatchRequest,
    previous: ProductMatchResult,
  ): ProductMatchResult => {
    const request = productMatchRequestSchema.parse(requestInput);
    if (request.storeId !== storeId)
      throw Error("PRODUCT_MATCH_STORE_MISMATCH");
    const config = defaultProductMatcherConfig;
    if (
      previous.engineVersion !== config.version ||
      previous.candidates.some((candidate) => changed.has(candidate.productId))
    )
      return matchActiveProduct(request, active, config);
    if (!changed.size) return previous;
    return matchActiveProduct(request, active, config, (normalizedLabel) => {
      // An unchanged exact match would have returned above. Only fuzzy results
      // (or no candidates) can reach this incremental ranking.
      if (previous.method !== "FUZZY_LABEL" && previous.method !== null)
        return fuzzyResult(normalizedLabel, active, config);
      const additions = fuzzyResult(normalizedLabel, changedCatalog, config);
      return rankedFuzzyResult(
        [...previous.candidates, ...additions.candidates],
        config,
      );
    });
  };
}

function matchActiveProduct(
  request: z.output<typeof productMatchRequestSchema>,
  activeCatalog: ActiveCatalog,
  config: ProductMatcherConfig,
  fuzzy?: (label: string) => ProductMatchResult,
): ProductMatchResult {
  const identifierResult = matchIdentifiers(
    request.identifiers,
    activeCatalog,
    config.version,
  );
  if (identifierResult) {
    return identifierResult;
  }

  const normalizedLabel = request.label
    ? normalizeProductLabel(request.label)
    : "";
  if (!normalizedLabel) {
    return noMatch(config.version);
  }

  const aliasCandidates = exactAliasCandidates(normalizedLabel, activeCatalog);
  if (aliasCandidates.length > 0) {
    return exactTextResult(aliasCandidates, "VALIDATED_ALIAS", config.version);
  }

  const canonicalCandidates = exactCanonicalCandidates(
    normalizedLabel,
    activeCatalog,
  );
  if (canonicalCandidates.length > 0) {
    return exactTextResult(
      canonicalCandidates,
      "CANONICAL_LABEL",
      config.version,
    );
  }

  return fuzzy
    ? fuzzy(normalizedLabel)
    : fuzzyResult(normalizedLabel, activeCatalog, config);
}

function getActiveCatalog(
  storeId: string,
  catalog: ProductMatchCatalog,
): ActiveCatalog {
  const products = new Map(
    catalog.products
      .filter(
        (product) =>
          product.storeId === storeId &&
          product.status === "ACTIVE" &&
          !product.deletedAt,
      )
      .map((product) => [product.id, product]),
  );

  const identifiers = catalog.identifiers.filter(
    (identifier) =>
      identifier.storeId === storeId &&
      identifier.status === "VALIDATED" &&
      !identifier.deletedAt &&
      products.has(identifier.productId),
  );
  const aliases = catalog.aliases.filter(
    (alias) =>
      alias.storeId === storeId &&
      alias.status === "VALIDATED" &&
      !alias.deletedAt &&
      products.has(alias.productId),
  );
  const identifiersByValue = new Map<string, string[]>();
  for (const identifier of identifiers) {
    const key = JSON.stringify([identifier.type, identifier.value]);
    const entries = identifiersByValue.get(key) ?? [];
    entries.push(identifier.productId);
    identifiersByValue.set(key, entries);
  }
  const aliasesByProduct = new Map<string, ProductAlias[]>();
  for (const alias of aliases) {
    const entries = aliasesByProduct.get(alias.productId) ?? [];
    entries.push(alias);
    aliasesByProduct.set(alias.productId, entries);
  }
  const canonicalLabels = new Map(
    [...products.values()].map((p) => [p.id, normalizeProductLabel(p.label)]),
  );
  const idsByLabel = new Map<string, string[]>();
  const idsByAlias = new Map<string, string[]>();
  for (const [id, label] of canonicalLabels)
    idsByLabel.set(label, [...(idsByLabel.get(label) ?? []), id].sort());
  for (const alias of aliases)
    idsByAlias.set(
      alias.normalizedAlias,
      [
        ...new Set([
          ...(idsByAlias.get(alias.normalizedAlias) ?? []),
          alias.productId,
        ]),
      ].sort(),
    );
  return {
    products,
    identifiers,
    aliases,
    identifiersByValue,
    aliasesByProduct,
    canonicalLabels,
    idsByLabel,
    idsByAlias,
  };
}

function matchIdentifiers(
  requestedIdentifiers: Array<{
    type: z.infer<typeof productIdentifierTypeSchema>;
    value: string;
  }>,
  catalog: ActiveCatalog,
  engineVersion: string,
): ProductMatchResult | null {
  const matchedByType = new Map<
    z.infer<typeof productIdentifierTypeSchema>,
    Set<string>
  >();

  for (const requested of requestedIdentifiers) {
    const productIds =
      catalog.identifiersByValue.get(
        JSON.stringify([requested.type, requested.value]),
      ) ?? [];

    if (productIds.length === 0) {
      continue;
    }

    const existing = matchedByType.get(requested.type) ?? new Set<string>();
    productIds.forEach((productId) => existing.add(productId));
    matchedByType.set(requested.type, existing);
  }

  const productIds = [
    ...new Set([...matchedByType.values()].flatMap((matches) => [...matches])),
  ].sort();

  if (productIds.length === 0) {
    return null;
  }

  const candidates = productIds.map((productId) => ({
    productId,
    score: 1,
    method: "EXACT_IDENTIFIER" as const,
    reasons: [...matchedByType.entries()]
      .filter(([, matches]) => matches.has(productId))
      .map(([type]) => `EXACT_${type}`),
    identifierMatch: true,
    labelSimilarity: null,
  }));

  if (productIds.length > 1) {
    return productMatchResultSchema.parse({
      engineVersion,
      state: "AMBIGUOUS",
      matchedProductId: null,
      method: "EXACT_IDENTIFIER",
      candidates,
      conflict: {
        kind: "IDENTIFIER_CONFLICT",
        identifierTypes: [...matchedByType.keys()].sort(),
        productIds,
      },
    });
  }

  return productMatchResultSchema.parse({
    engineVersion,
    state: "AUTO_MATCH",
    matchedProductId: productIds[0],
    method: "EXACT_IDENTIFIER",
    candidates,
    conflict: null,
  });
}

function exactAliasCandidates(normalizedLabel: string, catalog: ActiveCatalog) {
  return catalog.idsByAlias.get(normalizedLabel) ?? [];
}
function exactCanonicalCandidates(
  normalizedLabel: string,
  catalog: ActiveCatalog,
) {
  return catalog.idsByLabel.get(normalizedLabel) ?? [];
}

function exactTextResult(
  productIds: string[],
  method: "VALIDATED_ALIAS" | "CANONICAL_LABEL",
  engineVersion: string,
): ProductMatchResult {
  const candidates = productIds.map((productId) => ({
    productId,
    score: 1,
    method,
    reasons: [method],
    identifierMatch: false,
    labelSimilarity: 1,
  }));

  return productMatchResultSchema.parse({
    engineVersion,
    state: productIds.length === 1 ? "AUTO_MATCH" : "AMBIGUOUS",
    matchedProductId: productIds.length === 1 ? productIds[0] : null,
    method,
    candidates,
    conflict: null,
  });
}

function fuzzyResult(
  normalizedLabel: string,
  catalog: ActiveCatalog,
  config: ProductMatcherConfig,
): ProductMatchResult {
  const candidates = [...catalog.products.values()]
    .map((product): ProductMatchCandidate => {
      const canonicalScore = labelSimilarity(
        normalizedLabel,
        catalog.canonicalLabels.get(product.id)!,
      );
      const aliasScore = (
        catalog.aliasesByProduct.get(product.id) ?? []
      ).reduce(
        (best, alias) =>
          Math.max(
            best,
            labelSimilarity(normalizedLabel, alias.normalizedAlias),
          ),
        0,
      );
      const score = roundScore(Math.max(canonicalScore, aliasScore));

      return {
        productId: product.id,
        score,
        method: "FUZZY_LABEL",
        reasons: [
          aliasScore > canonicalScore
            ? "FUZZY_VALIDATED_ALIAS"
            : "FUZZY_CANONICAL_LABEL",
        ],
        identifierMatch: false,
        labelSimilarity: score,
      };
    })
    .filter((candidate) => candidate.score >= config.fuzzyCandidateThreshold);
  return rankedFuzzyResult(candidates, config);
}
function rankedFuzzyResult(
  input: ProductMatchCandidate[],
  config: ProductMatcherConfig,
): ProductMatchResult {
  const candidates = input
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.productId.localeCompare(right.productId),
    )
    .slice(0, config.maxCandidates);

  if (candidates.length === 0) {
    return noMatch(config.version);
  }

  const topScore = candidates[0]?.score ?? 0;
  const secondScore = candidates[1]?.score ?? 0;
  const isAmbiguous =
    candidates.length > 1 &&
    (topScore < config.fuzzyReviewThreshold ||
      topScore - secondScore <= config.fuzzyAmbiguityDelta);

  return productMatchResultSchema.parse({
    engineVersion: config.version,
    state: isAmbiguous ? "AMBIGUOUS" : "REVIEW",
    matchedProductId: null,
    method: "FUZZY_LABEL",
    candidates,
    conflict: null,
  });
}

function noMatch(engineVersion: string): ProductMatchResult {
  return productMatchResultSchema.parse({
    engineVersion,
    state: "NO_MATCH",
    matchedProductId: null,
    method: null,
    candidates: [],
    conflict: null,
  });
}

function labelSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const editSimilarity =
    1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const dice = (2 * intersection) / (leftTokens.size + rightTokens.size);
  const coverage = intersection / Math.min(leftTokens.size, rightTokens.size);

  return Math.max(editSimilarity, dice * 0.7 + coverage * 0.3);
}

function levenshteinDistance(left: string, right: string) {
  let previous = Int32Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  let current = new Int32Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    const leftCode = left.charCodeAt(leftIndex - 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! +
          (leftCode === right.charCodeAt(rightIndex - 1) ? 0 : 1),
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[right.length] ?? right.length;
}

function roundScore(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
