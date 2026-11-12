import {
  addContextDays,
  selectStoreEventTime,
  storeProductEventSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";

/** Read existing events with their labels, without loading the whole catalogue. */
export async function journalObservations(
  db: OutboxDatabase,
  storeId: string,
  date: string,
  today: string,
) {
  if (date > today) return [];
  const start = selectStoreEventTime(date, "00:00");
  const end = selectStoreEventTime(addContextDays(date, 1), "00:00");
  const rows = await db.getAllAsync<{
    payload_json: string;
    sync_state: string;
    label: string | null;
  }>(
    `SELECT e.payload_json,e.sync_state,p.label FROM store_product_events e
     LEFT JOIN products p ON p.id=e.product_id AND p.store_id=e.store_id
     WHERE e.store_id=? AND json_extract(e.payload_json,'$.source')='USER'
       AND json_extract(e.payload_json,'$.startedAt') < ?
       AND (json_extract(e.payload_json,'$.endedAt') IS NULL OR json_extract(e.payload_json,'$.endedAt') >= ?)
     ORDER BY json_extract(e.payload_json,'$.startedAt') DESC,e.id LIMIT 4`,
    storeId,
    end,
    start,
  );
  return rows.map((r) => ({
    entity: storeProductEventSchema.parse(JSON.parse(r.payload_json)),
    syncState: r.sync_state,
    label: r.label ?? "Produit conservé",
  }));
}
