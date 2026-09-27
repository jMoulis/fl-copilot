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
};

export function matchProduct(
  requestInput: ProductMatchRequest,
  catalog: ProductMatchCatalog,
  configInput: ProductMatcherConfig = defaultProductMatcherConfig,
): ProductMatchResult {
  const request = productMatchRequestSchema.parse(requestInput);
  const config = productMatcherConfigSchema.parse(configInput);
  const activeCatalog = getActiveCatalog(request.storeId, catalog);

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

  return fuzzyResult(normalizedLabel, activeCatalog, config);
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

  return {
    products,
    identifiers: catalog.identifiers.filter(
      (identifier) =>
        identifier.storeId === storeId &&
        identifier.status === "VALIDATED" &&
        !identifier.deletedAt &&
        products.has(identifier.productId),
    ),
    aliases: catalog.aliases.filter(
      (alias) =>
        alias.storeId === storeId &&
        alias.status === "VALIDATED" &&
        !alias.deletedAt &&
        products.has(alias.productId),
    ),
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
    const productIds = catalog.identifiers
      .filter(
        (identifier) =>
          identifier.type === requested.type &&
          identifier.value === requested.value,
      )
      .map((identifier) => identifier.productId);

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
  return [
    ...new Set(
      catalog.aliases
        .filter((alias) => alias.normalizedAlias === normalizedLabel)
        .map((alias) => alias.productId),
    ),
  ].sort();
}

function exactCanonicalCandidates(
  normalizedLabel: string,
  catalog: ActiveCatalog,
) {
  return [...catalog.products.values()]
    .filter(
      (product) => normalizeProductLabel(product.label) === normalizedLabel,
    )
    .map((product) => product.id)
    .sort();
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
        normalizeProductLabel(product.label),
      );
      const aliasScore = catalog.aliases
        .filter((alias) => alias.productId === product.id)
        .reduce(
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
    .filter((candidate) => candidate.score >= config.fuzzyCandidateThreshold)
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
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[right.length] ?? right.length;
}

function roundScore(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
