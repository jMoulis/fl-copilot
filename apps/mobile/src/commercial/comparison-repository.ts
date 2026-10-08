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
        .filter((c) =>
          d.before.some(
            (o) =>
              o.readingId === c.entity.source.readingId &&
              o.operationIndex === c.entity.source.operationIndex &&
              o.itemIndex === c.entity.source.itemIndex,
          ),
        )
        .map((c) => ({
          choice: c,
          plans: plans.filter((p) =>
            p.offerRefs.some((r) => r.choiceId === c.entity.id),
          ),
        })),
    }));
  return { comparison, impacts };
}
