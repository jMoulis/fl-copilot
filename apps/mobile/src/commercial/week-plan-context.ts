import {
  commercialWeekPreparationSchema,
  commercialVersionDecisionSchema,
  synchronizedCommercialVisualReadingSchema,
  type CommercialWeekPreparation,
} from "@fl-copilot/sync-contracts";
import type { CommercialPlanContext } from "@fl-copilot/commercial-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { readCommercialChoices } from "./offer-choice-repository";
import { readValidatedOffers } from "./validated-offer-repository";
export async function readWeekPlanContext(
  db: OutboxDatabase,
  prep: CommercialWeekPreparation,
): Promise<CommercialPlanContext> {
  const [row, choices, validated, prefs, products, pages] = await Promise.all([
    db.getFirstAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM commercial_week_preparations WHERE store_id=? AND id=?",
      prep.storeId,
      prep.id,
    ),
    readCommercialChoices(db, prep.storeId),
    readValidatedOffers(db, prep.storeId),
    db.getAllAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM commercial_version_decisions WHERE store_id=?",
      prep.storeId,
    ),
    db.getAllAsync<{
      id: string;
      label: string;
      version: number;
      sync_state: string;
    }>(
      "SELECT id,label,version,sync_state FROM products WHERE store_id=? AND status='ACTIVE' AND deleted_at IS NULL",
      prep.storeId,
    ),
    db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_visual_readings WHERE store_id=?",
      prep.storeId,
    ),
  ]);
  const selected = choices.filter((c) =>
      prep.offerRefs.some((r) => r.choiceId === c.entity.id),
    ),
    docs = new Set(selected.map((c) => c.entity.source.sourceDocumentId));
  return {
    preparation: row
      ? commercialWeekPreparationSchema.parse(JSON.parse(row.payload_json))
      : null,
    choices: choices.map((c) => c.entity),
    validated: validated
      .filter((v) => !["ERROR", "CONFLICT"].includes(v.syncState))
      .map((v) => v.entity),
    preferences: prefs.map((p) =>
      commercialVersionDecisionSchema.parse(JSON.parse(p.payload_json)),
    ),
    products: products.map((p) => ({
      id: p.id,
      label: p.label,
      version: p.version,
    })),
    pages: pages.map((p) =>
      synchronizedCommercialVisualReadingSchema.parse(
        JSON.parse(p.payload_json),
      ),
    ),
    blocked: [
      ...products
        .filter(
          (p) =>
            ["ERROR", "CONFLICT"].includes(p.sync_state) &&
            selected.some((c) => c.entity.productId === p.id),
        )
        .map(() => "PRODUCT_SYNC"),
      ...(row && ["ERROR", "CONFLICT"].includes(row.sync_state)
        ? ["PREPARATION_SYNC"]
        : []),
      ...selected
        .filter((c) => ["ERROR", "CONFLICT"].includes(c.syncState))
        .map(() => "CHOICE_SYNC"),
      ...prefs
        .filter((p) => {
          const d = commercialVersionDecisionSchema.parse(
            JSON.parse(p.payload_json),
          );
          return (
            ["ERROR", "CONFLICT"].includes(p.sync_state) &&
            [d.before.documentId, d.after.documentId].some((id) => docs.has(id))
          );
        })
        .map(() => "REFERENCE_SYNC"),
    ],
  };
}
