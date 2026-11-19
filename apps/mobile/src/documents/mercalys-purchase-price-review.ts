import type {
  MercalysImportValidationLine,
  MercalysImportValidationSummary,
} from "./mercalys-import-validation";
import { z } from "zod";
import type { OutboxDatabase } from "../sync/outbox-repository";

export const purchasePriceSelectionSchema = z.object({
  productId: z.string().uuid(),
  businessDate: z.string().date(),
  sourceIndexes: z.array(z.number().int().nonnegative()).min(2),
  selectedSourceIndex: z.number().int().nonnegative(),
  actorUserId: z.string().uuid(),
  decidedAt: z.string().datetime({ offset: true }),
});
export type PurchasePriceSelection = z.infer<
  typeof purchasePriceSelectionSchema
>;
const ignoredReason = "PURCHASE_PRICE_NOT_SELECTED";
export function isUnselectedPurchasePrice(line: MercalysImportValidationLine) {
  return line.match.candidates.some((c) => c.reasons.includes(ignoredReason));
}

/** Unpublished review drafts stay local, scoped like confirmation sessions.
 * On publication the same decision travels with the immutable source records. */
export class PurchasePriceSelectionDraft {
  private key: string;
  constructor(
    private db: OutboxDatabase,
    storeId: string,
    ownerId: string,
    checksum: string,
  ) {
    this.key = `mercalys-price-selection:v1:${storeId}:${ownerId}:${checksum}`;
  }
  async read() {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    );
    return row
      ? z.array(purchasePriceSelectionSchema).parse(JSON.parse(row.value))
      : [];
  }
  async save(selections: PurchasePriceSelection[]) {
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      this.key,
      JSON.stringify(z.array(purchasePriceSelectionSchema).parse(selections)),
      new Date().toISOString(),
    );
  }
}

export function selectPurchasePrice(
  summary: MercalysImportValidationSummary,
  sourceIndex: number,
  actorUserId: string,
  decidedAt: string,
) {
  const selected = summary.lines.find(
    (l) => l.record.sourceIndex === sourceIndex,
  );
  if (
    summary.sourceType !== "MERCALYS_PURCHASE_PRICES" ||
    !selected?.match.matchedProductId
  )
    throw Error("PURCHASE_PRICE_SELECTION_CHANGED");
  const group = summary.lines.filter(
    (l) =>
      l.match.matchedProductId === selected.match.matchedProductId &&
      l.record.businessDate === selected.record.businessDate,
  );
  if (
    !group.some(hasPurchasePriceCollision) ||
    group.some(
      (l) =>
        summary.publishedSourceIndexes?.includes(l.record.sourceIndex) &&
        l.record.sourceIndex !== sourceIndex,
    )
  )
    throw Error("PURCHASE_PRICE_SELECTION_CHANGED");
  const selection = purchasePriceSelectionSchema.parse({
    productId: selected.match.matchedProductId,
    businessDate: selected.record.businessDate,
    sourceIndexes: group.map((l) => l.record.sourceIndex).sort((a, b) => a - b),
    selectedSourceIndex: sourceIndex,
    actorUserId,
    decidedAt,
  });
  return reviewPurchasePriceCollisions({
    ...summary,
    purchasePriceSelections: [
      ...(summary.purchasePriceSelections ?? []).filter(
        (s) =>
          s.productId !== selection.productId ||
          s.businessDate !== selection.businessDate,
      ),
      selection,
    ],
  });
}

const reason = "MULTIPLE_PURCHASE_PRICES_FOR_PRODUCT_DATE";
export function hasPurchasePriceCollision(line: MercalysImportValidationLine) {
  return line.match.candidates.some((c) => c.reasons.includes(reason));
}

/** Source rows stay immutable. A matching identity alone does not make two
 * prices for the same product/day publishable. Never pick the first or last. */
export function reviewPurchasePriceCollisions(
  summary: MercalysImportValidationSummary,
  publishedIndexes: ReadonlySet<number> = new Set(
    summary.publishedSourceIndexes ?? [],
  ),
): MercalysImportValidationSummary {
  if (summary.sourceType !== "MERCALYS_PURCHASE_PRICES") return summary;
  const restored = summary.lines.map((line) =>
    hasPurchasePriceCollision(line) || isUnselectedPurchasePrice(line)
      ? {
          ...line,
          match: {
            ...line.match,
            state: "AUTO_MATCH" as const,
            candidates: line.match.candidates.map((c) => ({
              ...c,
              reasons: c.reasons.filter(
                (r) => r !== reason && r !== ignoredReason,
              ),
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
  const selections = (summary.purchasePriceSelections ?? []).filter(
    (selection) => {
      const group = restored.filter(
        (l) =>
          l.match.matchedProductId === selection.productId &&
          l.record.businessDate === selection.businessDate,
      );
      const members = group.filter((l) =>
        selection.sourceIndexes.includes(l.record.sourceIndex),
      );
      return (
        members.length >= 2 &&
        members.every((l) => l.match.state === "AUTO_MATCH") &&
        (publishedIndexes.has(selection.selectedSourceIndex) ||
          group.length === members.length) &&
        JSON.stringify(
          members.map((l) => l.record.sourceIndex).sort((a, b) => a - b),
        ) === JSON.stringify(selection.sourceIndexes) &&
        selection.sourceIndexes.includes(selection.selectedSourceIndex) &&
        group.every(
          (l) =>
            !publishedIndexes.has(l.record.sourceIndex) ||
            l.record.sourceIndex === selection.selectedSourceIndex,
        )
      );
    },
  );
  const lines = restored.map((line) => {
    const selection = selections.find(
      (s) =>
        `${s.productId}:${s.businessDate}` === key(line) &&
        s.sourceIndexes.includes(line.record.sourceIndex),
    );
    if (selection && line.record.sourceIndex === selection.selectedSourceIndex)
      return line;
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
            reasons: [
              ...(owner?.reasons ?? []),
              selection ? ignoredReason : reason,
            ],
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
    productReviewCount: lines.filter(
      (l) => l.match.state !== "AUTO_MATCH" && !isUnselectedPurchasePrice(l),
    ).length,
    ...(summary.purchasePriceSelections
      ? { purchasePriceSelections: selections }
      : {}),
  };
}
