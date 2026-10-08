import {
  synchronizedCommercialVisualReadingSchema,
  type SynchronizedCommercialVisualReading,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
export async function applyCommercialVisualReading(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
) {
  const reading = synchronizedCommercialVisualReadingSchema.parse(payload);
  if (reading.storeId !== storeId)
    throw Error("COMMERCIAL_VISUAL_STORE_MISMATCH");
  const previous = await db.getFirstAsync<{
    store_id: string;
    payload_json: string;
  }>(
    "SELECT store_id,payload_json FROM commercial_visual_readings WHERE id = ?",
    reading.id,
  );
  if (
    previous &&
    (previous.store_id !== storeId ||
      previous.payload_json !== JSON.stringify(reading))
  )
    throw Error("COMMERCIAL_VISUAL_IMMUTABLE_READING");
  await db.runAsync(
    "INSERT OR IGNORE INTO commercial_visual_readings(id,store_id,source_document_id,page_number,payload_json) VALUES (?,?,?,?,?)",
    reading.id,
    storeId,
    reading.sourceDocumentId,
    reading.pageNumber,
    JSON.stringify(reading),
  );
}
export async function readCommercialVisualReadings(
  db: OutboxDatabase,
  storeId: string,
  sourceDocumentId: string,
): Promise<SynchronizedCommercialVisualReading[]> {
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_visual_readings WHERE store_id = ? AND source_document_id = ? ORDER BY page_number",
    storeId,
    sourceDocumentId,
  );
  return rows.map((row) =>
    synchronizedCommercialVisualReadingSchema.parse(
      JSON.parse(row.payload_json),
    ),
  );
}
