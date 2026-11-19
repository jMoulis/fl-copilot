import type {
  MercalysImportValidationLine,
  MercalysImportValidationSummary,
} from "./mercalys-import-validation";

const reason = "MULTIPLE_PURCHASE_PRICES_FOR_PRODUCT_DATE";
export function hasPurchasePriceCollision(line: MercalysImportValidationLine) {
  return line.match.candidates.some((c) => c.reasons.includes(reason));
}

/** Source rows stay immutable. A matching identity alone does not make two
 * prices for the same product/day publishable. Never pick the first or last. */
export function reviewPurchasePriceCollisions(
  summary: MercalysImportValidationSummary,
  publishedIndexes: ReadonlySet<number> = new Set(),
): MercalysImportValidationSummary {
  if (summary.sourceType !== "MERCALYS_PURCHASE_PRICES") return summary;
  const restored = summary.lines.map((line) =>
    hasPurchasePriceCollision(line)
      ? {
          ...line,
          match: {
            ...line.match,
            state: "AUTO_MATCH" as const,
            candidates: line.match.candidates.map((c) => ({
              ...c,
              reasons: c.reasons.filter((r) => r !== reason),
            })),
          },
        }
      : line,
  );
  const counts = new Map<string, number>();
  const key = (line: MercalysImportValidationLine) =>
    `${line.match.matchedProductId}:${line.record.businessDate}`;
  for (const line of restored) {
    if (line.match.state === "AUTO_MATCH" && line.match.matchedProductId)
      counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);
  }
  const lines = restored.map((line) => {
    if (
      line.match.state !== "AUTO_MATCH" ||
      !line.match.matchedProductId ||
      (counts.get(key(line)) ?? 0) < 2 ||
      publishedIndexes.has(line.record.sourceIndex)
    )
      return line;
    const candidates = line.match.candidates.filter(
      (c) => c.productId !== line.match.matchedProductId,
    );
    const owner = line.match.candidates.find(
      (c) => c.productId === line.match.matchedProductId,
    );
    return {
      ...line,
      match: {
        ...line.match,
        state: "REVIEW" as const,
        candidates: [
          ...candidates,
          {
            ...owner,
            productId: line.match.matchedProductId,
            score: owner?.score ?? 1,
            method: owner?.method ?? ("EXACT_IDENTIFIER" as const),
            reasons: [...(owner?.reasons ?? []), reason],
          },
        ],
      },
    };
  });
  const readyCount = lines.filter((l) => l.match.state === "AUTO_MATCH").length;
  return {
    ...summary,
    lines,
    readyCount,
    productReviewCount: lines.length - readyCount,
  };
}
