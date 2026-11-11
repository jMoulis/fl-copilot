import { documentReadyNotificationSchema } from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Fixed owned local routes only. A push cannot supply a URL or publish a document. */
export async function documentNotificationDestination(
  db: OutboxDatabase,
  scope: { ownerId: string; storeId: string; role: string },
  raw: unknown,
) {
  const parsed = documentReadyNotificationSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.ownerId !== scope.ownerId ||
    parsed.data.storeId !== scope.storeId ||
    scope.role !== "MANAGER"
  )
    return;
  const data = parsed.data;
  const source = await db.getFirstAsync<{ source_type: string }>(
    "SELECT source_type FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
    data.sourceDocumentId,
    scope.storeId,
  );
  if (source?.source_type !== data.sourceType) return;
  if (data.sourceType === "WEEKLY_COMMERCIAL_PDF")
    return {
      pathname: "/(tabs)/commercial-review/[id]" as const,
      params: { id: data.sourceDocumentId },
    };
  const receipt = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM waste_receipts WHERE source_document_id=? AND store_id=? AND deleted_at IS NULL LIMIT 1",
    data.sourceDocumentId,
    scope.storeId,
  );
  if (receipt)
    return {
      pathname: "/waste-receipt/[id]" as const,
      params: { id: receipt.id },
    };
}
