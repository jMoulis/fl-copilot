import { createHash } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import {
  sourceOriginalMetadataSchema,
  sourceOriginalDownloadSchema,
  serializeSourceOriginalMetadata,
  type SourceOriginalManifest,
  type SourceOriginalDownload,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import {
  sourceObjectKey,
  createVercelSourceBlobStorage,
  type SourceBlobStorage,
} from "./source-upload-service.js";
import { signPrivateOriginal } from "./private-original-link.js";

export interface SourceOriginalService {
  manifest(
    storeId: string,
    actorId: string,
    sourceId: string,
    authorize?: () => Promise<void>,
  ): Promise<SourceOriginalManifest>;
  download(
    storeId: string,
    actorId: string,
    sourceId: string,
    authorize?: () => Promise<void>,
  ): Promise<SourceOriginalDownload>;
}
const unavailable = () =>
  new AuthError(
    404,
    "SOURCE_ORIGINAL_UNAVAILABLE",
    "L’original n’est pas disponible pour ce magasin ou ce compte.",
  );
const invalid = () =>
  new AuthError(
    409,
    "SOURCE_ORIGINAL_INVALID",
    "Les informations de l’original doivent être vérifiées avant sa récupération.",
  );

export function createSourceOriginalService(
  database: DatabaseService,
  storage: Pick<SourceBlobStorage, "head"> = createVercelSourceBlobStorage(),
  sign = signPrivateOriginal,
  now: () => Date = () => new Date(),
): SourceOriginalService {
  async function lookup(storeId: string, actorId: string, sourceId: string) {
    z.uuid().parse(storeId);
    z.uuid().parse(actorId);
    z.uuid().parse(sourceId);
    const db = await database.getDb();
    const [source, upload] = await Promise.all([
      db.collection<Document & { _id: string }>("sourceDocuments").findOne(
        {
          _id: sourceId,
          storeId,
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      ),
      db
        .collection("sourceUploads")
        .findOne(
          { sourceDocumentId: sourceId, storeId, status: "CONFIRMED" },
          { maxTimeMS: 2000 },
        ),
    ]);
    if (
      !source ||
      !upload ||
      source.deletedAt != null ||
      source.remoteUploadStatus !== "CONFIRMED" ||
      source._id !== sourceId ||
      source.storeId !== storeId ||
      upload.storeId !== storeId ||
      upload.sourceDocumentId !== sourceId ||
      upload.status !== "CONFIRMED"
    )
      throw unavailable();
    if (source.sourceType === "STORE_PHOTO" && upload.userId !== actorId)
      throw unavailable();
    const parsed = sourceOriginalMetadataSchema.safeParse({
      schemaVersion: 1,
      sourceDocumentId: sourceId,
      storeId,
      access: source.sourceType === "STORE_PHOTO" ? "OWNER" : "STORE",
      ownerId: source.sourceType === "STORE_PHOTO" ? upload.userId : null,
      sourceType: source.sourceType,
      filename: source.originalFilename,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      checksum: source.checksum,
      registeredAt:
        source.createdAt instanceof Date &&
        Number.isFinite(source.createdAt.getTime())
          ? source.createdAt.toISOString()
          : null,
      objectVersion: upload.blob?.etag ?? null,
    });
    if (!parsed.success) throw invalid();
    const metadata = parsed.data;
    const objectKey = sourceObjectKey(storeId, {
      sourceDocumentId: sourceId,
      sourceType: metadata.sourceType,
      filename: metadata.filename,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      checksum: metadata.checksum,
    });
    if (
      source.objectKey !== objectKey ||
      upload.objectKey !== objectKey ||
      upload.sourceType !== metadata.sourceType ||
      upload.filename !== metadata.filename ||
      upload.mimeType !== metadata.mimeType ||
      upload.sizeBytes !== metadata.sizeBytes ||
      upload.checksum !== metadata.checksum ||
      !upload.blob ||
      upload.blob.pathname !== objectKey ||
      upload.blob.size !== metadata.sizeBytes ||
      upload.blob.contentType !== metadata.mimeType ||
      !metadata.objectVersion ||
      (source.blobEtag != null && source.blobEtag !== metadata.objectVersion)
    )
      throw invalid();
    return {
      objectKey,
      metadata,
      manifest: {
        ...metadata,
        manifestHash: `sha256:${createHash("sha256").update(serializeSourceOriginalMetadata(metadata)).digest("hex")}`,
      } satisfies SourceOriginalManifest,
    };
  }
  async function checked(storeId: string, actorId: string, sourceId: string) {
    const first = await lookup(storeId, actorId, sourceId);
    const blob = await storage.head(first.objectKey);
    if (!blob) throw unavailable();
    if (
      blob.pathname !== first.objectKey ||
      blob.size !== first.metadata.sizeBytes ||
      blob.contentType !== first.metadata.mimeType ||
      blob.etag !== first.metadata.objectVersion
    )
      throw invalid();
    const current = await lookup(storeId, actorId, sourceId);
    if (current.manifest.manifestHash !== first.manifest.manifestHash)
      throw invalid();
    return current;
  }
  return {
    async manifest(storeId, actorId, sourceId, authorize) {
      const current = await checked(storeId, actorId, sourceId);
      await authorize?.();
      return current.manifest;
    },
    async download(storeId, actorId, sourceId, authorize) {
      const current = await checked(storeId, actorId, sourceId),
        expiry = now().getTime() + 120_000;
      const url = await sign(current.objectKey, expiry);
      const latest = await lookup(storeId, actorId, sourceId);
      if (latest.manifest.manifestHash !== current.manifest.manifestHash)
        throw invalid();
      await authorize?.();
      if (now().getTime() >= expiry) throw unavailable();
      return sourceOriginalDownloadSchema.parse({
        manifest: current.manifest,
        url,
        expiresAt: new Date(expiry).toISOString(),
      });
    },
  };
}
