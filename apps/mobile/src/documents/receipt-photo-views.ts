import { z } from "zod";
import {
  MAX_RECEIPT_VIEWS,
  RECEIPT_PHOTO_BUNDLE_MIME,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
const viewSchema = z.strictObject({
  localUri: z.string().startsWith("file://").max(4096),
  mimeType: z.enum(["image/jpeg", "image/png", "image/heic", "image/heif"]),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export const localReceiptPhotoViewsSchema = z
  .array(viewSchema)
  .min(2)
  .max(MAX_RECEIPT_VIEWS);
export type LocalReceiptPhotoView = z.infer<typeof viewSchema>;

export async function readReceiptPhotoViews(
  db: OutboxDatabase,
  storeId: string,
  sourceDocumentId: string,
) {
  const parents = await db.getAllAsync<{ mime_type: string; checksum: string }>(
    "SELECT f.mime_type,d.checksum FROM source_documents d JOIN waste_receipts r ON r.source_document_id=d.id AND r.store_id=d.store_id JOIN local_files f ON f.id=r.local_file_id AND f.store_id=d.store_id AND f.source_document_id=d.id AND f.checksum=d.checksum WHERE d.id=? AND d.store_id=? AND d.source_type='WASTE_RECEIPT' AND d.deleted_at IS NULL AND r.deleted_at IS NULL AND f.retention_status='RETAINED' LIMIT 2",
    sourceDocumentId,
    storeId,
  );
  if (parents.length !== 1) return null;
  const parent = parents[0]!;
  if (parent.mime_type !== RECEIPT_PHOTO_BUNDLE_MIME)
    return { grouped: false, views: [] as LocalReceiptPhotoView[] };
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM waste_receipt_photo_groups WHERE source_document_id=? AND store_id=? AND checksum=?",
    sourceDocumentId,
    storeId,
    parent.checksum,
  );
  if (!row) return { grouped: true, views: [] as LocalReceiptPhotoView[] };
  try {
    return {
      grouped: true,
      views: localReceiptPhotoViewsSchema.parse(JSON.parse(row.payload_json)),
    };
  } catch {
    return { grouped: true, views: [] as LocalReceiptPhotoView[] };
  }
}
