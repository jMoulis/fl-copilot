import { isCommercialOriginalSource } from "@fl-copilot/domain";
import { compareCommercialDocumentVersions } from "@fl-copilot/commercial-core";
import { readCommercialVisualReadings } from "./visual-repository";
import { readCommercialChoices } from "./offer-choice-repository";
import { commercialWeekPreparationSchema } from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
export async function readCommercialComparison(
  db: OutboxDatabase,
  storeId: string,
  beforeDocumentId: string,
  afterDocumentId: string,
) {
  const [before, after, choices, rows] = await Promise.all([
    readCommercialVisualReadings(db, storeId, beforeDocumentId),
    readCommercialVisualReadings(db, storeId, afterDocumentId),
    readCommercialChoices(db, storeId, beforeDocumentId),
    db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_week_preparations WHERE store_id=?",
      storeId,
    ),
  ]);
  const comparison = compareCommercialDocumentVersions({
      storeId,
      beforeDocumentId,
      afterDocumentId,
      before,
      after,
    }),
    plans = rows.map((r) =>
      commercialWeekPreparationSchema.parse(JSON.parse(r.payload_json)),
    );
  const impacts = comparison.differences
    .filter((d) => d.status !== "UNCHANGED")
    .map((d) => ({
      key: d.key,
      choices: choices
        .filter((c) => {
          const source = c.entity.source;
          return (
            !isCommercialOriginalSource(source) &&
            d.before.some(
              (o) =>
                o.readingId === source.readingId &&
                o.operationIndex === source.operationIndex &&
                o.itemIndex === source.itemIndex,
            )
          );
        })
        .map((c) => ({
          choice: c,
          plans: plans.filter((p) =>
            p.offerRefs.some((r) => r.choiceId === c.entity.id),
          ),
        })),
    }));
  const originalChoices = choices
    .filter(
      (c) =>
        isCommercialOriginalSource(c.entity.source) &&
        c.entity.status === "RETAINED",
    )
    .map((choice) => ({
      choice,
      plans: plans.filter((plan) =>
        plan.offerRefs.some((ref) => ref.choiceId === choice.entity.id),
      ),
    }));
  const snapshot = (documentId: string, pages: typeof before) => ({
    documentId,
    checksum: pages[0]?.checksum ?? "",
    readingIds: pages.map((p) => p.id).sort(),
  });
  return {
    comparison,
    impacts,
    originalChoices,
    sources: {
      before: snapshot(beforeDocumentId, before),
      after: snapshot(afterDocumentId, after),
    },
  };
}
