import {
  sourceOriginalManifestSchema,
  serializeSourceOriginalMetadata,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { sourceOriginalHash } from "./source-original-hash";
/** Join an earlier verified business original to metadata arriving through normal pull. */
export async function attachRecoveredSourceOriginal(
  tx: OutboxDatabase,
  storeId: string,
  sourceId: string,
) {
  const source = await tx.getFirstAsync<{
    source_type: string;
    checksum: string | null;
    local_file_uri: string | null;
    original_filename: string | null;
  }>(
    "SELECT source_type,checksum,local_file_uri,original_filename FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
    sourceId,
    storeId,
  );
  if (
    !source ||
    !source.checksum ||
    ![
      "MERCALYS_SALES",
      "MERCALYS_WASTE",
      "WASTE_RECEIPT",
      "WEEKLY_COMMERCIAL_PDF",
    ].includes(source.source_type)
  )
    return;
  const pending = await tx.getFirstAsync(
    "SELECT id FROM local_files WHERE source_document_id=? AND store_id=? AND upload_status!='CONFIRMED' LIMIT 1",
    sourceId,
    storeId,
  );
  if (pending) return;
  const rows = await tx.getAllAsync<{
    manifest_json: string;
    local_file_id: string;
    local_uri: string;
    mime_type: string;
    checksum: string;
    size_bytes: number;
  }>(
    "SELECT m.manifest_json,m.local_file_id,f.local_uri,f.mime_type,f.checksum,f.size_bytes FROM source_original_manifests m JOIN local_files f ON f.id=m.local_file_id AND f.source_document_id=m.source_document_id AND f.store_id=m.store_id WHERE m.store_id=? AND m.source_document_id=? AND f.retention_status='RETAINED' AND f.upload_status='CONFIRMED' ORDER BY m.verified_at DESC,m.owner_id LIMIT 20",
    storeId,
    sourceId,
  );
  for (const row of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.manifest_json);
    } catch {
      continue;
    }
    const result = sourceOriginalManifestSchema.safeParse(raw);
    if (!result.success) continue;
    const manifest = result.data;
    const { manifestHash, ...metadata } = manifest;
    if (
      sourceOriginalHash(serializeSourceOriginalMetadata(metadata)) !==
      manifestHash
    )
      continue;
    if (
      manifest.storeId !== storeId ||
      manifest.sourceDocumentId !== sourceId ||
      manifest.access !== "STORE" ||
      manifest.sourceType !== source.source_type ||
      manifest.checksum !== source.checksum ||
      manifest.checksum !== row.checksum ||
      manifest.mimeType !== row.mime_type ||
      manifest.sizeBytes !== row.size_bytes ||
      !row.local_uri.startsWith("file://") ||
      row.local_uri.includes("\0")
    )
      continue;
    // Never replace a local original, an edited receipt or its file reference.
    await tx.runAsync(
      "UPDATE source_documents SET local_file_uri=? WHERE id=? AND store_id=? AND local_file_uri IS NULL",
      row.local_uri,
      sourceId,
      storeId,
    );
    if (manifest.sourceType === "WASTE_RECEIPT") {
      await tx.runAsync(
        "UPDATE waste_receipts SET local_file_id=? WHERE source_document_id=? AND store_id=? AND local_file_id IS NULL AND deleted_at IS NULL",
        row.local_file_id,
        sourceId,
        storeId,
      );
    }
    return;
  }
}
