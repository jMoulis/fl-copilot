import { z } from "zod";
import {
  sourceOriginalMetadataSchema,
  sourceOriginalManifestSchema,
  sourceOriginalDownloadSchema,
  serializeSourceOriginalMetadata,
  type SourceOriginalManifest,
  type SourceOriginalDownload,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { localReceiptPhotoViewsSchema } from "./receipt-photo-views";
import { RECEIPT_PHOTO_BUNDLE_MIME } from "@fl-copilot/domain";
export const sourceOriginalProofSchema = z.strictObject({
  localUri: z.string().startsWith("file://").max(4096),
  views: localReceiptPhotoViewsSchema.nullable(),
});
export type SourceOriginalProof = z.infer<typeof sourceOriginalProofSchema>;
export type SourceOriginalSession = { storeId: string; userId: string };
export interface SourceOriginalFiles {
  hash(text: string): Promise<string>;
  existing(
    manifest: SourceOriginalManifest,
    uri: string,
    ownerId: string,
  ): Promise<SourceOriginalProof | null>;
  receive(
    lease: SourceOriginalDownload,
    ownerId: string,
    check: () => void,
  ): Promise<SourceOriginalProof>;
}
export interface SourceOriginalTransport {
  manifest(
    storeId: string,
    actorId: string,
    sourceId: string,
  ): Promise<SourceOriginalManifest>;
  download(
    storeId: string,
    actorId: string,
    sourceId: string,
  ): Promise<SourceOriginalDownload>;
}
type Database = AtomicMutationDatabase & OutboxDatabase;
type SourceRow = {
  id: string;
  store_id: string;
  source_type: string;
  checksum: string | null;
  local_file_uri: string | null;
  remote_upload_status: string;
  deleted_at: string | null;
  original_filename: string | null;
  created_at: string;
};
type FileRow = {
  id: string;
  store_id: string;
  source_document_id: string;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  retention_status: string;
  upload_status: string;
};
/** Read/cache only: no source parsing, business publication, upload job or Outbox command. */
export class SourceOriginalTransfer {
  private active = new Map<string, Promise<SourceOriginalProof>>();
  constructor(
    private db: Database,
    private api: SourceOriginalTransport,
    private files: SourceOriginalFiles,
    private session: () => SourceOriginalSession | null,
    private id: () => string,
    private now: () => Date = () => new Date(),
  ) {}
  private scope() {
    const s = this.session();
    if (!s) throw Error("SOURCE_ORIGINAL_SESSION_REQUIRED");
    return {
      storeId: z.uuid().parse(s.storeId),
      userId: z.uuid().parse(s.userId),
    };
  }
  private check(scope: SourceOriginalSession) {
    const current = this.session();
    if (current?.storeId !== scope.storeId || current.userId !== scope.userId)
      throw Error("SOURCE_ORIGINAL_SCOPE_CHANGED");
  }
  private async binding(
    raw: unknown,
    scope: SourceOriginalSession,
    id: string,
  ) {
    const manifest = sourceOriginalManifestSchema.parse(raw);
    if (
      manifest.sourceDocumentId !== id ||
      manifest.storeId !== scope.storeId ||
      (manifest.access === "OWNER" && manifest.ownerId !== scope.userId)
    )
      throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
    const { manifestHash, ...metadata } = manifest;
    if (
      (await this.files.hash(serializeSourceOriginalMetadata(metadata))) !==
      manifestHash
    )
      throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
    this.check(scope);
    return manifest;
  }
  private async basis(
    tx: OutboxDatabase,
    scope: SourceOriginalSession,
    id: string,
  ) {
    const source = await tx.getFirstAsync<SourceRow>(
      "SELECT id,store_id,source_type,checksum,local_file_uri,remote_upload_status,deleted_at,original_filename,created_at FROM source_documents WHERE id=?",
      id,
    );
    const files = await tx.getAllAsync<FileRow>(
      "SELECT id,store_id,source_document_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status FROM local_files WHERE source_document_id=? ORDER BY id",
      id,
    );
    const receipt = await tx.getFirstAsync<{
      local_file_id: string | null;
      store_id: string;
      deleted_at: string | null;
    }>(
      "SELECT local_file_id,store_id,deleted_at FROM waste_receipts WHERE source_document_id=?",
      id,
    );
    this.check(scope);
    if (
      (source && (source.store_id !== scope.storeId || source.deleted_at)) ||
      files.some((f) => f.store_id !== scope.storeId) ||
      (receipt && (receipt.store_id !== scope.storeId || receipt.deleted_at))
    )
      throw Error("SOURCE_ORIGINAL_UNAVAILABLE");
    return { source, files, receipt };
  }
  async local(sourceId: string): Promise<SourceOriginalProof | null> {
    z.uuid().parse(sourceId);
    const scope = this.scope(),
      basis = await this.basis(this.db, scope, sourceId);
    const row = await this.db.getFirstAsync<{
      manifest_json: string;
      local_file_id: string;
    }>(
      "SELECT manifest_json,local_file_id FROM source_original_manifests WHERE store_id=? AND owner_id=? AND source_document_id=?",
      scope.storeId,
      scope.userId,
      sourceId,
    );
    let manifest: SourceOriginalManifest;
    let selectedId: string;
    if (row) {
      manifest = await this.binding(
        JSON.parse(row.manifest_json),
        scope,
        sourceId,
      );
      selectedId = row.local_file_id;
    } else {
      // A captured original is already useful offline, even before its upload/remote manifest.
      const source = basis.source;
      const retained = basis.files.filter(
        (f) =>
          f.retention_status === "RETAINED" &&
          f.checksum === source?.checksum &&
          (!source.local_file_uri || f.local_uri === source.local_file_uri),
      );
      if (!source || retained.length !== 1) return null;
      const file = retained[0]!;
      if (source.source_type === "STORE_PHOTO") {
        const owner = await this.db.getFirstAsync<{ id: string }>(
          "SELECT id FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.sourceDocumentId')=? LIMIT 1",
          scope.storeId,
          scope.userId,
          sourceId,
        );
        this.check(scope);
        if (!owner) return null;
      }
      const metadata = sourceOriginalMetadataSchema.safeParse({
        schemaVersion: 1,
        sourceDocumentId: sourceId,
        storeId: scope.storeId,
        access: source.source_type === "STORE_PHOTO" ? "OWNER" : "STORE",
        ownerId: source.source_type === "STORE_PHOTO" ? scope.userId : null,
        sourceType: source.source_type,
        filename: source.original_filename,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        checksum: file.checksum,
        registeredAt: source.created_at,
        objectVersion: null,
      });
      if (!metadata.success) return null;
      manifest = {
        ...metadata.data,
        manifestHash: await this.files.hash(
          serializeSourceOriginalMetadata(metadata.data),
        ),
      };
      selectedId = file.id;
    }
    if (
      basis.source &&
      (basis.source.checksum !== manifest.checksum ||
        basis.source.source_type !== manifest.sourceType)
    )
      throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
    const file = basis.files.find((f) => f.id === selectedId);
    if (
      !file ||
      file.checksum !== manifest.checksum ||
      file.mime_type !== manifest.mimeType ||
      file.size_bytes !== manifest.sizeBytes ||
      file.retention_status !== "RETAINED"
    )
      return null;
    const proof = await this.files.existing(
      manifest,
      file.local_uri,
      scope.userId,
    );
    this.check(scope);
    return proof;
  }
  recover(
    sourceId: string,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
  ): Promise<SourceOriginalProof> {
    z.uuid().parse(sourceId);
    const scope = this.scope(),
      key = `${scope.storeId}:${scope.userId}:${sourceId}`,
      existing = this.active.get(key);
    if (existing) return existing;
    const work = this.run(scope, sourceId, authorize);
    this.active.set(key, work);
    void work
      .finally(() => {
        if (this.active.get(key) === work) this.active.delete(key);
      })
      .catch(() => undefined);
    return work;
  }
  private async run(
    scope: SourceOriginalSession,
    sourceId: string,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
  ) {
    await authorize?.();
    const cached = await this.local(sourceId);
    if (cached) {
      await authorize?.();
      this.check(scope);
      return cached;
    }
    const before = await this.basis(this.db, scope, sourceId);
    if (
      before.files.some((f) => f.upload_status !== "CONFIRMED") ||
      (before.source && before.source.remote_upload_status !== "CONFIRMED")
    )
      throw Error("SOURCE_ORIGINAL_LOCAL_PENDING");
    const lease = sourceOriginalDownloadSchema.parse(
      await this.api.download(scope.storeId, scope.userId, sourceId),
    );
    const manifest = await this.binding(lease.manifest, scope, sourceId);
    if (
      Date.parse(lease.expiresAt) <= this.now().getTime() ||
      Date.parse(lease.expiresAt) > this.now().getTime() + 125_000
    )
      throw Error("SOURCE_ORIGINAL_LEASE_EXPIRED");
    if (
      before.source &&
      (before.source.source_type !== manifest.sourceType ||
        before.source.checksum !== manifest.checksum)
    )
      throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
    if (
      before.files.some(
        (f) =>
          f.checksum !== manifest.checksum ||
          f.mime_type !== manifest.mimeType ||
          f.size_bytes !== manifest.sizeBytes,
      )
    )
      throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
    let proof: SourceOriginalProof | null = null;
    // Prefer verified retained original bytes, even when their old manifest cache is missing.
    for (const file of before.files) {
      if (file.retention_status === "RETAINED")
        proof = await this.files.existing(
          manifest,
          file.local_uri,
          scope.userId,
        );
      this.check(scope);
      if (proof) break;
    }
    proof ??= await this.files.receive(lease, scope.userId, () =>
      this.check(scope),
    );
    proof = sourceOriginalProofSchema.parse(proof);
    this.check(scope);
    if (
      (manifest.mimeType === RECEIPT_PHOTO_BUNDLE_MIME) !==
      (proof.views !== null)
    )
      throw Error("SOURCE_ORIGINAL_FILE_INVALID");
    const current = await this.binding(
      await this.api.manifest(scope.storeId, scope.userId, sourceId),
      scope,
      sourceId,
    );
    if (current.manifestHash !== manifest.manifestHash)
      throw Error("SOURCE_ORIGINAL_CHANGED");
    const result = proof,
      at = this.now().toISOString();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await authorize?.(tx);
      this.check(scope);
      if (
        JSON.stringify(await this.basis(tx, scope, sourceId)) !==
        JSON.stringify(before)
      )
        throw Error("SOURCE_ORIGINAL_LOCAL_CHANGED");
      const fileId =
        before.receipt?.local_file_id ??
        before.files[0]?.id ??
        z.uuid().parse(this.id());
      const collision = await tx.getFirstAsync<{
        source_document_id: string;
        store_id: string;
      }>(
        "SELECT source_document_id,store_id FROM local_files WHERE id=?",
        fileId,
      );
      if (
        collision &&
        (collision.source_document_id !== sourceId ||
          collision.store_id !== scope.storeId)
      )
        throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
      await tx.runAsync(
        "INSERT INTO local_files(id,store_id,source_document_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'RETAINED','CONFIRMED',?,?) ON CONFLICT(id) DO UPDATE SET local_uri=excluded.local_uri,retention_status='RETAINED',updated_at=excluded.updated_at",
        fileId,
        scope.storeId,
        sourceId,
        result.localUri,
        manifest.mimeType,
        manifest.sizeBytes,
        manifest.checksum,
        at,
        at,
      );
      if (before.source)
        await tx.runAsync(
          "UPDATE source_documents SET local_file_uri=? WHERE id=? AND store_id=?",
          result.localUri,
          sourceId,
          scope.storeId,
        );
      if (before.receipt && before.receipt.local_file_id === null)
        await tx.runAsync(
          "UPDATE waste_receipts SET local_file_id=? WHERE source_document_id=? AND store_id=? AND local_file_id IS NULL",
          fileId,
          sourceId,
          scope.storeId,
        );
      if (result.views)
        await tx.runAsync(
          "INSERT INTO waste_receipt_photo_groups(source_document_id,store_id,checksum,payload_json) VALUES(?,?,?,?) ON CONFLICT(source_document_id) DO UPDATE SET payload_json=excluded.payload_json WHERE waste_receipt_photo_groups.store_id=excluded.store_id AND waste_receipt_photo_groups.checksum=excluded.checksum",
          sourceId,
          scope.storeId,
          manifest.checksum,
          JSON.stringify(result.views),
        );
      await tx.runAsync(
        "INSERT INTO source_original_manifests(store_id,owner_id,source_document_id,manifest_json,local_file_id,views_json,verified_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(store_id,owner_id,source_document_id) DO UPDATE SET manifest_json=excluded.manifest_json,local_file_id=excluded.local_file_id,views_json=excluded.views_json,verified_at=excluded.verified_at",
        scope.storeId,
        scope.userId,
        sourceId,
        JSON.stringify(manifest),
        fileId,
        result.views ? JSON.stringify(result.views) : null,
        at,
      );
      this.check(scope);
    });
    return result;
  }
}
