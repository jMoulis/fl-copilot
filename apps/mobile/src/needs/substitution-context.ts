import type { OutboxDatabase } from "@/sync/outbox-repository";
export type SourceMarginContext = {
  productId: string;
  businessDate: string;
  marginValue: string | null;
  marginRate: string | null;
  sourceDocumentId: string | null;
  sourceRecordId: string | null;
  observationCount: number;
};
export async function readSubstitutionMarginContext(
  db: OutboxDatabase,
  storeId: string,
  productIds: string[],
) {
  const ids = [...new Set(productIds)];
  const result: Record<string, SourceMarginContext> = {};
  if (!ids.length) return result;
  const rows = await db.getAllAsync<{
    product_id: string;
    business_date: string;
    margin_value: string | null;
    margin_rate: string | null;
    source_document_id: string;
    source_record_id: string;
  }>(
    `SELECT s.product_id,s.business_date,s.margin_value,s.margin_rate,s.source_document_id,s.source_record_id FROM sales_observations s WHERE s.store_id=? AND s.product_id IN (${ids.map(() => "?").join(",")}) AND s.validation_status='VALIDATED' AND s.deleted_at IS NULL AND s.business_date=(SELECT MAX(x.business_date) FROM sales_observations x WHERE x.store_id=s.store_id AND x.product_id=s.product_id AND x.validation_status='VALIDATED' AND x.deleted_at IS NULL)`,
    storeId,
    ...ids,
  );
  for (const row of rows) {
    const old = result[row.product_id];
    result[row.product_id] = old
      ? {
          ...old,
          marginValue: null,
          marginRate: null,
          sourceDocumentId: null,
          sourceRecordId: null,
          observationCount: old.observationCount + 1,
        }
      : {
          productId: row.product_id,
          businessDate: row.business_date,
          marginValue: row.margin_value,
          marginRate: row.margin_rate,
          sourceDocumentId: row.source_document_id,
          sourceRecordId: row.source_record_id,
          observationCount: 1,
        };
  }
  return result;
}
export function sourceMarginLabel(m: SourceMarginContext | undefined) {
  if (!m) return "Aucune observation Mercalys publiée pour ce produit.";
  const date = m.businessDate.split("-").reverse().join("/");
  if (m.observationCount > 1)
    return `${date} · ${m.observationCount} observations sources : pas de comparaison de marge sans consolidation.`;
  return `${date} · montant de marge source : ${m.marginValue === null ? "indisponible" : Number(m.marginValue).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"} · taux source : ${m.marginRate === null ? "indisponible" : m.marginRate.replace(".", ",") + " %"}`;
}
