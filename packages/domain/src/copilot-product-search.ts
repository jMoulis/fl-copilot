import { z } from "zod";
import {
  productSchema,
  productIdentifierTypeSchema,
  normalizeProductLabel,
  type Product,
} from "./products";
import {
  matchProduct,
  defaultProductMatcherConfig,
  type ProductMatchCatalog,
  productMatchCandidateSchema,
  productMatchStateSchema,
} from "./product-matching";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotProductSearchInputSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(240).nullable(),
    identifiers: z
      .array(
        z.strictObject({
          type: productIdentifierTypeSchema,
          value: z.string().trim().min(1).max(80),
        }),
      )
      .max(3),
  })
  .refine(
    (v) => !!normalizeProductLabel(v.label ?? "") || v.identifiers.length > 0,
    "Un nom ou un code est nécessaire.",
  );
export const copilotProductSearchResultSchema = z
  .strictObject({
    status: z.enum(["COMPLETE_CATALOG", "LIMIT_EXCEEDED"]),
    state: productMatchStateSchema.nullable(),
    matchedProductId: z.string().uuid().nullable(),
    candidateCount: z.number().int().nonnegative().nullable(),
    hasMoreCandidates: z.boolean(),
    candidates: z
      .array(
        z.strictObject({
          product: productSchema,
          basis: z.enum([
            "EXACT_IDENTIFIER",
            "VALIDATED_ALIAS",
            "CANONICAL_LABEL",
            "FUZZY_LABEL",
            "LABEL_TERMS",
          ]),
          score: z.number().min(0).max(1).nullable(),
          reasons: z.array(z.string()),
        }),
      )
      .max(5),
    missingIdentifiers: copilotProductSearchInputSchema.shape.identifiers,
    evidence: z.array(copilotEvidenceSchema).max(6),
  })
  .superRefine((r, c) => {
    const fail = () =>
      c.addIssue({
        code: "custom",
        message: "Inconsistent product lookup result",
      });
    if (r.status === "LIMIT_EXCEEDED") {
      if (
        r.state !== null ||
        r.matchedProductId !== null ||
        r.candidates.length ||
        r.candidateCount !== null ||
        r.hasMoreCandidates ||
        r.missingIdentifiers.length
      )
        fail();
      return;
    }
    if (
      r.state === null ||
      r.candidateCount === null ||
      r.candidateCount < r.candidates.length ||
      r.hasMoreCandidates !== r.candidateCount > r.candidates.length
    )
      fail();
    if (r.state === "AUTO_MATCH") {
      if (
        !r.matchedProductId ||
        r.candidateCount !== 1 ||
        r.candidates.length !== 1 ||
        r.candidates[0]?.product.id !== r.matchedProductId ||
        ["FUZZY_LABEL", "LABEL_TERMS"].includes(r.candidates[0]?.basis ?? "")
      )
        fail();
    } else if (r.matchedProductId !== null) fail();
    if (r.state === "NO_MATCH" && r.candidateCount !== 0) fail();
  });
/** Lookup can suggest literal label terms without turning them into an automatic business match. */
export function searchCopilotProducts(
  storeId: string,
  raw: unknown,
  catalog: ProductMatchCatalog,
) {
  const input = copilotProductSearchInputSchema.parse(raw);
  const match = matchProduct(
    { storeId, label: input.label, identifiers: input.identifiers },
    catalog,
    {
      ...defaultProductMatcherConfig,
      maxCandidates: Math.max(1, catalog.products.length),
    },
  );
  const active = catalog.products.filter(
    (p) => p.storeId === storeId && p.status === "ACTIVE" && !p.deletedAt,
  );
  const byId = new Map(active.map((p) => [p.id, p]));
  type Candidate = {
    product: Product;
    basis:
      z.infer<typeof productMatchCandidateSchema>["method"] | "LABEL_TERMS";
    score: number | null;
    reasons: string[];
  };
  const candidates: Candidate[] = match.candidates.map((c) => ({
    product: byId.get(c.productId)!,
    basis: c.method,
    score: c.score,
    reasons: c.reasons,
  }));
  let state = match.state,
    matchedProductId = match.matchedProductId;
  if (
    input.label &&
    (match.method === "FUZZY_LABEL" || match.state === "NO_MATCH")
  ) {
    const terms = normalizeProductLabel(input.label).split(" ").filter(Boolean);
    const lexical = terms.length
      ? active
          .filter((p) =>
            terms.every((t) =>
              normalizeProductLabel(p.label).split(" ").includes(t),
            ),
          )
          .sort(
            (a, b) =>
              normalizeProductLabel(a.label).localeCompare(
                normalizeProductLabel(b.label),
                "fr-FR",
              ) || a.id.localeCompare(b.id),
          )
      : [];
    const ids = new Set(lexical.map((p) => p.id));
    candidates.splice(
      0,
      candidates.length,
      ...lexical.map((product) => ({
        product,
        basis: "LABEL_TERMS" as const,
        score: null,
        reasons: [
          "Tous les termes du nom sont présents ; identité à confirmer.",
        ],
      })),
      ...candidates.filter((c) => !ids.has(c.product.id)),
    );
    if (candidates.length) {
      state = candidates.length > 1 ? "AMBIGUOUS" : "REVIEW";
      matchedProductId = null;
    }
  }
  const missingIdentifiers = input.identifiers.filter(
    (i) =>
      !catalog.identifiers.some(
        (c) =>
          c.storeId === storeId &&
          c.status === "VALIDATED" &&
          !c.deletedAt &&
          byId.has(c.productId) &&
          c.type === i.type &&
          c.value === i.value,
      ),
  );
  return {
    state,
    matchedProductId,
    candidates: candidates.slice(0, 5),
    candidateCount: candidates.length,
    hasMoreCandidates: candidates.length > 5,
    missingIdentifiers,
  };
}
