import { sourceOriginalManifestSchema } from "@fl-copilot/sync-contracts";
import {
  storePhotoSourceMetadataSchema,
  VISUAL_LIBRARY_POLICY,
  type StorePhotoSourceMetadata,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { CapturedVisualSource } from "../products/visual-library-actions";
import type { VisualFileStorage } from "../products/visual-file-storage-port";
import type { SourceOriginalProof } from "../documents/source-original-transfer";

/** Metadata only. The existing original transfer owns file/manifest/owner verification. */
export async function localVisualSourcePhoto(
  db: OutboxDatabase,
  scope: { storeId: string; ownerId: string },
  expected: StorePhotoSourceMetadata,
) {
  const row = await db.getFirstAsync<{
    store_id: string;
    source_type: string;
    original_filename: string | null;
    checksum: string | null;
    deleted_at: string | null;
  }>(
    "SELECT store_id,source_type,original_filename,checksum,deleted_at FROM source_documents WHERE id=?",
    expected.sourceDocumentId,
  );
  if (
    row &&
    (row.store_id !== scope.storeId ||
      row.source_type !== "STORE_PHOTO" ||
      row.deleted_at ||
      row.original_filename !== expected.filename ||
      row.checksum !== expected.checksum)
  )
    return null;
  const cached = await db.getFirstAsync<{ manifest_json: string }>(
    "SELECT manifest_json FROM source_original_manifests WHERE store_id=? AND owner_id=? AND source_document_id=?",
    scope.storeId,
    scope.ownerId,
    expected.sourceDocumentId,
  );
  if (cached) {
    const m = sourceOriginalManifestSchema.parse(
      JSON.parse(cached.manifest_json),
    );
    if (
      m.storeId !== scope.storeId ||
      m.ownerId !== scope.ownerId ||
      m.access !== "OWNER" ||
      JSON.stringify(
        storePhotoSourceMetadataSchema.parse({
          sourceDocumentId: m.sourceDocumentId,
          sourceType: m.sourceType,
          filename: m.filename,
          checksum: m.checksum,
          registeredAt: m.registeredAt,
          mimeType: m.mimeType,
          sizeBytes: m.sizeBytes,
        }),
      ) !== JSON.stringify(expected)
    )
      return null;
  }
  // A remote-only proposal is displayable; actual managed bytes/ownership are mandatory before save.
  return storePhotoSourceMetadataSchema.parse(expected);
}
export type PreparedVisualSourcePhoto = {
  source: CapturedVisualSource;
  uri: string;
};
export interface VisualSourcePhotoPort {
  prepare(
    metadata: StorePhotoSourceMetadata,
    check: () => void,
  ): Promise<PreparedVisualSourcePhoto>;
  verify(
    metadata: StorePhotoSourceMetadata,
    prepared: PreparedVisualSourcePhoto,
    check: () => void,
  ): Promise<void>;
}
export function createVisualSourcePhotoPort(
  storeId: string,
  originals: {
    local(sourceId: string): Promise<SourceOriginalProof | null>;
    request(sourceId: string): Promise<void>;
  },
  files: VisualFileStorage,
): VisualSourcePhotoPort {
  async function retained(
    metadata: StorePhotoSourceMetadata,
    check: () => void,
  ) {
    check();
    const proof = await originals.local(metadata.sourceDocumentId);
    check();
    if (!proof || proof.views) throw Error("VISUAL_SOURCE_ORIGINAL_REQUIRED");
    return proof;
  }
  function binding(
    metadata: StorePhotoSourceMetadata,
    prepared: PreparedVisualSourcePhoto,
  ) {
    if (
      prepared.source.contentHash !== metadata.checksum ||
      prepared.source.mimeType !== metadata.mimeType ||
      prepared.source.sizeBytes !== metadata.sizeBytes
    )
      throw Error("VISUAL_SOURCE_FILE_CHANGED");
  }
  return {
    async prepare(metadata, check) {
      check();
      if (metadata.sizeBytes > VISUAL_LIBRARY_POLICY.maximumBytes)
        throw Error("VISUAL_SOURCE_SIZE_LIMIT");
      let proof: SourceOriginalProof;
      try {
        proof = await retained(metadata, check);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "VISUAL_SOURCE_ORIGINAL_REQUIRED"
        ) {
          await originals.request(metadata.sourceDocumentId);
          check();
        }
        throw error;
      }
      const source = await files.capture(storeId, proof.localUri);
      check();
      const uri = await files.uri(storeId, "SOURCE", source);
      check();
      if (!uri) throw Error("VISUAL_SOURCE_ORIGINAL_REQUIRED");
      const prepared = { source, uri };
      binding(metadata, prepared);
      return prepared;
    },
    async verify(metadata, prepared, check) {
      await retained(metadata, check);
      binding(metadata, prepared);
      await files.read(storeId, "SOURCE", prepared.source);
      check();
    },
  };
}
