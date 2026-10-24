import {
  commercialOfferChoiceSchema,
  type CommercialOfferChoice,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
export type CommercialChoiceRow = {
  id: string;
  store_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalCommercialChoice = {
  entity: CommercialOfferChoice;
  remoteVersion: number | null;
  syncState: string;
  remote: CommercialOfferChoice | null;
  lastErrorCode: string | null;
};
export function mapCommercialChoice(
  row: CommercialChoiceRow,
): LocalCommercialChoice {
  return {
    entity: commercialOfferChoiceSchema.parse(JSON.parse(row.payload_json)),
    remoteVersion: row.remote_version,
    syncState: row.sync_state,
    remote: row.remote_payload_json
      ? commercialOfferChoiceSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
    lastErrorCode: row.last_error_code ?? null,
  };
}
export async function readCommercialChoice(
  db: OutboxDatabase,
  storeId: string,
  id: string,
): Promise<LocalCommercialChoice | null> {
  const row = await db.getFirstAsync<CommercialChoiceRow>(
    `SELECT c.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=c.store_id AND o.entity_id=c.id AND o.entity_type='commercial_offer_choice' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_offer_choices c WHERE c.store_id=? AND c.id=?`,
    storeId,
    id,
  );
  return row ? mapCommercialChoice(row) : null;
}
export async function readCommercialChoices(
  db: OutboxDatabase,
  storeId: string,
  sourceDocumentId?: string,
) {
  const rows = await db.getAllAsync<CommercialChoiceRow>(
    `SELECT c.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=c.store_id AND o.entity_id=c.id AND o.entity_type='commercial_offer_choice' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_offer_choices c WHERE c.store_id=? ${sourceDocumentId ? "AND source_document_id=?" : ""}`,
    storeId,
    ...(sourceDocumentId ? [sourceDocumentId] : []),
  );
  return rows.map(mapCommercialChoice);
}
