import { normalizeCommercialDraftMechanisms } from "./mechanism-normalization";
import {
  commercialOfferCandidateSchema,
  type CommercialOfferCandidate,
  type CommercialOfferConflictCode,
} from "@fl-copilot/domain";

function literal(value: string | null) {
  return (
    value
      ?.normalize("NFKC")
      .toLocaleLowerCase("fr-FR")
      .replace(/\s+/g, " ")
      .trim() ?? null
  );
}
// Zod parsing gives canonical property order for mechanisms; rawLabel remains evidence.
function purchase(candidate: CommercialOfferCandidate) {
  const condition = candidate.purchaseCondition;
  if (!condition) return null;
  return { ...condition, rawLabel: literal(condition.rawLabel) };
}
function terms(candidate: CommercialOfferCandidate) {
  return {
    saleStart: literal(candidate.saleStart),
    saleEnd: literal(candidate.saleEnd),
    mechanism: candidate.mechanism,
    purchaseCondition: purchase(candidate),
    // A card benefit does not contain the independent selling price.
    rawSellingPrice:
      candidate.mechanism?.type === "CARD_BENEFIT" || !candidate.mechanism
        ? literal(candidate.rawSellingPrice)
        : null,
    rawMechanism: !candidate.mechanism ? literal(candidate.rawMechanism) : null,
    rawPriceOperator: !candidate.mechanism
      ? literal(candidate.rawPriceOperator)
      : null,
    rawSalesUnit: !candidate.mechanism ? literal(candidate.rawSalesUnit) : null,
    rawPurchasePrice:
      candidate.purchaseCondition?.purchasePrice == null
        ? literal(candidate.rawPurchasePrice)
        : null,
  };
}
function identity(candidate: CommercialOfferCandidate) {
  const product = candidate.productId
    ? ["PRODUCT", candidate.productId]
    : candidate.productIdentifiers.length
      ? ["IDENTIFIERS", ...[...new Set(candidate.productIdentifiers)].sort()]
      : candidate.rawProductLabel
        ? ["LABEL", literal(candidate.rawProductLabel)]
        : null;
  // Unknown operation/identity cannot merge: preserve this source occurrence.
  return JSON.stringify([
    candidate.storeId,
    candidate.sourceDocumentId,
    literal(candidate.operationKey),
    product,
    !candidate.operationKey || !product
      ? [candidate.pageNumber, candidate.sourceBlockIndex]
      : null,
  ]);
}
function occurrence(candidate: CommercialOfferCandidate) {
  return JSON.stringify([
    candidate.storeId,
    candidate.sourceDocumentId,
    candidate.pageNumber,
    candidate.sourceBlockIndex,
  ]);
}
function conflicts(a: CommercialOfferCandidate, b: CommercialOfferCandidate) {
  const left = terms(a),
    right = terms(b);
  const codes: CommercialOfferConflictCode[] = [];
  if (left.saleStart !== right.saleStart || left.saleEnd !== right.saleEnd)
    codes.push("SALE_PERIOD_CONFLICT");
  if (
    JSON.stringify(left.mechanism) !== JSON.stringify(right.mechanism) ||
    left.rawSellingPrice !== right.rawSellingPrice
  )
    codes.push("SELLING_MECHANISM_CONFLICT");
  if (
    JSON.stringify(left.purchaseCondition) !==
      JSON.stringify(right.purchaseCondition) ||
    left.rawPurchasePrice !== right.rawPurchasePrice
  )
    codes.push("PURCHASE_CONDITION_CONFLICT");
  if (
    left.rawMechanism !== right.rawMechanism ||
    left.rawPriceOperator !== right.rawPriceOperator ||
    left.rawSalesUnit !== right.rawSalesUnit
  )
    codes.push("UNRESOLVED_MECHANISM_CONFLICT");
  return codes;
}

/** Conservative document-local draft reconciliation. No publication or inferred date/product.
 * Every distinct terms variant remains inspectable. Incomplete rows cannot bridge conflicts. */
export function reconcileCommercialOffers(
  input: readonly CommercialOfferCandidate[],
) {
  const candidates = input.map((candidate) =>
    commercialOfferCandidateSchema.parse(candidate),
  );
  const occurrences = new Map<string, CommercialOfferCandidate>();
  for (const candidate of candidates) {
    const key = occurrence(candidate);
    const previous = occurrences.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate))
      throw new Error("COMMERCIAL_SOURCE_OCCURRENCE_CONFLICT");
    occurrences.set(key, candidate);
  }
  const buckets = new Map<string, CommercialOfferCandidate[]>();
  for (const candidate of occurrences.values()) {
    const key = identity(candidate);
    buckets.set(key, [...(buckets.get(key) ?? []), candidate]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => {
      const variants = new Map<string, CommercialOfferCandidate[]>();
      for (const candidate of entries) {
        const signature = JSON.stringify(terms(candidate));
        variants.set(signature, [
          ...(variants.get(signature) ?? []),
          candidate,
        ]);
      }
      const ordered = [...variants.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const issues = new Set<CommercialOfferConflictCode>();
      for (let j = 1; j < ordered.length; j++)
        for (const code of conflicts(ordered[0]![1][0]!, ordered[j]![1][0]!))
          issues.add(code);
      return {
        key,
        status: "TO_VALIDATE" as const,
        conflicts: [...issues].sort(),
        variants: ordered.map(([signature, rows]) => ({
          signature,
          occurrences: rows.sort(
            (a, b) =>
              a.pageNumber - b.pageNumber ||
              a.sourceBlockIndex - b.sourceBlockIndex,
          ),
          sourceReferences: rows.flatMap((row) =>
            row.evidence.map((evidence) => ({
              sourceDocumentId: row.sourceDocumentId,
              sourceBlockIndex: row.sourceBlockIndex,
              ...evidence,
            })),
          ),
        })),
      };
    });
}

export function reconcileCommercialDraftPages(input: {
  storeId: string;
  sourceDocumentId: string;
  pages: Array<{
    pageNumber: number;
    draft: import("./ai-draft-evidence").AnchoredCommercialDraft;
  }>;
}) {
  const candidates: CommercialOfferCandidate[] = [];
  for (const page of input.pages) {
    const normalized = normalizeCommercialDraftMechanisms(page.draft);
    for (const block of page.draft.blocks.filter(
      (item) => item.kind === "OFFER",
    )) {
      const field = (name: string) =>
        block.fields.find((item) => item.name === name)?.rawValue ?? null;
      const proposal = normalized.find(
        (item) => item.sourceBlockIndex === block.sourceBlockIndex,
      )!;
      candidates.push({
        storeId: input.storeId,
        sourceDocumentId: input.sourceDocumentId,
        pageNumber: page.pageNumber,
        sourceBlockIndex: block.sourceBlockIndex,
        operationKey: field("operationName"),
        productId: null,
        rawProductLabel: field("productLabel"),
        productIdentifiers: block.fields
          .filter(
            (item) =>
              item.name === "productIdentifier" && item.rawValue !== null,
          )
          .map((item) => item.rawValue!),
        saleStart: field("saleStart"),
        saleEnd: field("saleEnd"),
        mechanism: proposal.mechanism,
        purchaseCondition: proposal.purchaseCondition,
        rawMechanism: field("customerMechanism"),
        rawPriceOperator: field("priceOperator"),
        rawSalesUnit: field("salesUnit"),
        rawPurchasePrice: field("purchasePrice"),
        rawSellingPrice: field("sellingPrice"),
        evidence: block.evidence,
      });
    }
  }
  return reconcileCommercialOffers(candidates);
}
