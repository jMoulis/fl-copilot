import { randomUUID } from "node:crypto";
import { get, put, del } from "@vercel/blob";
import type { ClientSession } from "mongodb";
import {
  visualAssetSchema,
  visualAssetObjectKey,
  type VisualAsset,
} from "@fl-copilot/domain";
import {
  visualFileManifestSchema,
  readVisualFileManifest,
  type VisualFileManifest,
  type InitVisualFileResponse,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service";
import type { DatabaseService } from "../database/types";
import { createVercelSourceBlobStorage } from "../uploads/source-upload-service";
import {
  visualBytesHash,
  visualImageProcessor,
  type VisualImageProcessor,
} from "./visual-image-normalization";
import { serializeVisualEntity } from "./visual-library-sync";

export interface VisualFilePrincipal {
  storeId: string;
  userId: string;
  role: string;
}
export interface VisualFileStorage {
  uploadUrl(
    key: string,
    mime: string,
    size: number,
    validUntil: number,
  ): Promise<string>;
  read(key: string, maximumBytes: number): Promise<Uint8Array | null>;
  writeImmutable(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  removeStaging(key: string): Promise<void>;
}
export interface VisualFileService {
  init(
    context: VisualFilePrincipal,
    assetId: string,
  ): Promise<InitVisualFileResponse>;
  complete(
    context: VisualFilePrincipal,
    assetId: string,
    uploadId: string,
  ): Promise<VisualFileManifest>;
  manifest(
    context: VisualFilePrincipal,
    assetId: string,
  ): Promise<VisualFileManifest>;
  read(
    context: VisualFilePrincipal,
    assetId: string,
    variant: "source" | "preview",
  ): Promise<{ bytes: Uint8Array; mimeType: string; contentHash: string }>;
}
type Upload = {
  _id: string;
  storeId: string;
  userId: string;
  assetId: string;
  sourceHash: string;
  stagingKey: string;
  status: "PENDING" | "CONFIRMED" | "INVALID";
  expiresAt: Date;
  createdAt: Date;
  cleanupPending?: boolean;
  cleanupComplete?: boolean;
  errorCode?: string;
};
type StoredFile = {
  _id: string;
  storeId: string;
  sourceHash: string;
  sourceKey: string;
  previewKey: string;
  manifest: VisualFileManifest;
  verifiedAt: Date;
  verifiedBy: string;
};
const ttl = 10 * 60 * 1000;
const previewKeyFor = (asset: VisualAsset) =>
  `stores/${asset.storeId}/visual-assets/${asset.contentHash.slice(7)}.preview-v1.jpg`;
const failure = (
  status: number,
  code: string,
  message: string,
  retryable = false,
) => new AuthError(status, code, message, retryable);

export function createVisualBlobStorage(): VisualFileStorage {
  const signing = createVercelSourceBlobStorage();
  const storage: VisualFileStorage = {
    uploadUrl: (pathname, contentType, maximumSizeInBytes, validUntil) =>
      signing.createUploadUrl({
        pathname,
        contentType,
        maximumSizeInBytes,
        validUntil,
      }),
    async read(key, maximumBytes) {
      const result = await get(key, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      const reader = result.stream.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maximumBytes) {
            await reader.cancel();
            throw Error("VISUAL_FILE_TOO_LARGE");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
    async writeImmutable(key, bytes, mime) {
      try {
        await put(key, Buffer.from(bytes), {
          access: "private",
          contentType: mime,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
      } catch (error) {
        const existing = await storage.read(key, bytes.byteLength);
        if (
          !existing ||
          existing.byteLength !== bytes.byteLength ||
          visualBytesHash(existing) !== visualBytesHash(bytes)
        )
          throw error;
      }
    },
    removeStaging: async (key) => {
      await del(key);
    },
  };
  return storage;
}

export function createVisualFileService(
  database: DatabaseService,
  storage: VisualFileStorage = createVisualBlobStorage(),
  processor: VisualImageProcessor = visualImageProcessor,
  now: () => Date = () => new Date(),
): VisualFileService {
  async function asset(
    context: VisualFilePrincipal,
    id: string,
    write = false,
    session?: ClientSession,
  ): Promise<VisualAsset> {
    const db = await database.getDb();
    const member = await db.collection("storeMemberships").findOne(
      {
        storeId: context.storeId,
        userId: context.userId,
        active: true,
        ...(write ? { role: "MANAGER" } : {}),
      },
      { session },
    );
    if (!member)
      throw failure(
        403,
        "VISUAL_ACCESS_INVALID",
        "Vous ne pouvez pas accéder à ces images.",
      );
    const row = await db
      .collection<{ _id: string }>("visualAssets")
      .findOne({ _id: id, storeId: context.storeId }, { session });
    if (!row)
      throw failure(
        404,
        "VISUAL_ASSET_UNAVAILABLE",
        "Cette image n’est pas disponible dans le magasin actif.",
      );
    const value = visualAssetSchema.parse(
      serializeVisualEntity("visual_asset", row),
    );
    if (value.deletedAt || value.review.status !== "APPROVED")
      throw failure(
        409,
        "VISUAL_REVIEW_REQUIRED",
        "Cette image n’est pas approuvée ou a été retirée.",
      );
    return value;
  }
  async function stored(value: VisualAsset, session?: ClientSession) {
    const db = await database.getDb();
    const row = await db
      .collection<StoredFile>("visualAssetFiles")
      .findOne({ _id: value.id, storeId: value.storeId }, { session });
    if (!row) return null;
    const manifest = readVisualFileManifest(row.manifest, value);
    if (
      row.sourceHash !== value.contentHash ||
      row.sourceKey !== visualAssetObjectKey(value) ||
      row.previewKey !== previewKeyFor(value)
    )
      throw Error("VISUAL_STORED_FILE_INVALID");
    return { ...row, manifest };
  }
  async function cleanup(row: Upload) {
    if (
      row.cleanupComplete ||
      (row.status !== "CONFIRMED" && row.expiresAt > now())
    )
      return;
    if (row.stagingKey !== `stores/${row.storeId}/visual-staging/${row._id}`)
      return;
    try {
      await storage.removeStaging(row.stagingKey);
      await (
        await database.getDb()
      )
        .collection<Upload>("visualAssetUploads")
        .updateOne(
          {
            _id: row._id,
            storeId: row.storeId,
            $or: [{ status: "CONFIRMED" }, { expiresAt: { $lte: now() } }],
          },
          { $set: { cleanupPending: false, cleanupComplete: true } },
        );
    } catch {
      /* The verified canonical original remains durable. Retry on the next init/complete. */
    }
  }
  async function retryCleanup(
    context: VisualFilePrincipal,
    value: VisualAsset,
  ) {
    const rows = await (
      await database.getDb()
    )
      .collection<Upload>("visualAssetUploads")
      .find({
        storeId: context.storeId,
        userId: context.userId,
        assetId: value.id,
        sourceHash: value.contentHash,
        cleanupComplete: { $ne: true },
        $or: [
          { status: "CONFIRMED", cleanupPending: true },
          { expiresAt: { $lte: now() } },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(3)
      .toArray();
    for (const row of rows) await cleanup(row);
  }
  const service: VisualFileService = {
    async init(context, assetId): Promise<InitVisualFileResponse> {
      const value = await asset(context, assetId, true),
        existing = await stored(value);
      if (existing) {
        await retryCleanup(context, value);
        return {
          state: "READY",
          uploadId: null,
          uploadUrl: null,
          expiresAt: null,
          headers: {},
          manifest: existing.manifest,
        };
      }
      const db = await database.getDb(),
        uploads = db.collection<Upload>("visualAssetUploads"),
        time = now();
      let upload = await uploads.findOne({
        storeId: context.storeId,
        userId: context.userId,
        assetId,
        sourceHash: value.contentHash,
        status: "PENDING",
        expiresAt: { $gt: time },
      });
      if (!upload) {
        const id = randomUUID();
        upload = {
          _id: id,
          storeId: context.storeId,
          userId: context.userId,
          assetId,
          sourceHash: value.contentHash,
          stagingKey: `stores/${context.storeId}/visual-staging/${id}`,
          status: "PENDING",
          createdAt: time,
          expiresAt: new Date(time.getTime() + ttl),
        };
        await uploads.insertOne(upload);
      }
      const uploadUrl = await storage.uploadUrl(
        upload.stagingKey,
        value.mimeType,
        value.sizeBytes,
        upload.expiresAt.getTime(),
      );
      return {
        state: "UPLOAD_REQUIRED",
        uploadId: upload._id,
        uploadUrl,
        expiresAt: upload.expiresAt.toISOString(),
        headers: { "content-type": value.mimeType },
        manifest: null,
      };
    },
    async complete(context, assetId, uploadId) {
      const value = await asset(context, assetId, true),
        db = await database.getDb(),
        uploads = db.collection<Upload>("visualAssetUploads");
      const upload = await uploads.findOne({
        _id: uploadId,
        storeId: context.storeId,
        userId: context.userId,
        assetId,
      });
      if (!upload || upload.sourceHash !== value.contentHash)
        throw failure(
          404,
          "VISUAL_UPLOAD_UNAVAILABLE",
          "Cet envoi n’est pas disponible.",
        );
      const existing = await stored(value);
      if (upload.status === "CONFIRMED" && existing) {
        await cleanup(upload);
        return existing.manifest;
      }
      if (upload.status !== "PENDING" || upload.expiresAt <= now())
        throw failure(
          409,
          "VISUAL_UPLOAD_EXPIRED",
          "Reprenez l’envoi de cette image.",
          true,
        );
      let bytes: Uint8Array | null;
      try {
        bytes = await storage.read(upload.stagingKey, value.sizeBytes);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "VISUAL_FILE_TOO_LARGE"
        )
          throw error;
        await uploads.updateOne(
          { _id: uploadId, storeId: context.storeId, status: "PENDING" },
          { $set: { status: "INVALID", errorCode: "VISUAL_FILE_INVALID" } },
        );
        throw failure(
          400,
          "VISUAL_FILE_INVALID",
          "Le fichier reçu dépasse la taille prévue. Votre original reste conservé sur le téléphone.",
        );
      }
      if (!bytes)
        throw failure(
          409,
          "VISUAL_FILE_MISSING",
          "Le fichier n’a pas encore été reçu. Réessayez l’envoi.",
          true,
        );
      let preview: Awaited<ReturnType<VisualImageProcessor["normalize"]>>;
      try {
        preview = await processor.normalize(bytes, value);
      } catch {
        await uploads.updateOne(
          { _id: uploadId, storeId: context.storeId, status: "PENDING" },
          { $set: { status: "INVALID", errorCode: "VISUAL_FILE_INVALID" } },
        );
        throw failure(
          400,
          "VISUAL_FILE_INVALID",
          "Le fichier reçu ne correspond pas à l’image attendue ou ne peut pas être lu. Votre original reste conservé sur le téléphone.",
        );
      }
      const sourceKey = visualAssetObjectKey(value),
        previewKey = previewKeyFor(value);
      const manifest = visualFileManifestSchema.parse({
        assetId,
        storeId: value.storeId,
        processorVersion: "visual-image.v1",
        source: {
          contentHash: value.contentHash,
          mimeType: value.mimeType,
          sizeBytes: value.sizeBytes,
          width: value.width,
          height: value.height,
        },
        preview: {
          contentHash: visualBytesHash(preview.bytes),
          mimeType: "image/jpeg",
          sizeBytes: preview.bytes.byteLength,
          width: preview.width,
          height: preview.height,
        },
      });
      await storage.writeImmutable(sourceKey, bytes, value.mimeType);
      await storage.writeImmutable(previewKey, preview.bytes, "image/jpeg");
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await asset(context, assetId, true, session);
          if (current.contentHash !== value.contentHash)
            throw Error("VISUAL_BINARY_CHANGED");
          const files = db.collection<StoredFile>("visualAssetFiles"),
            prior = await stored(current, session);
          if (
            prior &&
            JSON.stringify(prior.manifest) !== JSON.stringify(manifest)
          )
            throw Error("VISUAL_PREVIEW_CHANGED");
          await files.updateOne(
            { _id: assetId, storeId: value.storeId },
            {
              $setOnInsert: {
                _id: assetId,
                storeId: value.storeId,
                sourceHash: value.contentHash,
                sourceKey,
                previewKey,
                manifest,
                verifiedAt: now(),
                verifiedBy: context.userId,
              },
            },
            { upsert: true, session },
          );
          const claimed = await uploads.updateOne(
            {
              _id: uploadId,
              storeId: value.storeId,
              userId: context.userId,
              status: { $in: ["PENDING", "CONFIRMED"] },
            },
            { $set: { status: "CONFIRMED", cleanupPending: true } },
            { session },
          );
          if (claimed.matchedCount !== 1) throw Error("VISUAL_UPLOAD_CHANGED");
        });
      } finally {
        await session.endSession();
      }
      await cleanup({ ...upload, status: "CONFIRMED", cleanupPending: true });
      return manifest;
    },
    async manifest(context, assetId) {
      const value = await asset(context, assetId),
        file = await stored(value);
      if (!file)
        throw failure(
          404,
          "VISUAL_FILE_PENDING",
          "L’image n’a pas encore terminé son envoi.",
          true,
        );
      return file.manifest;
    },
    async read(context, assetId, variant) {
      const value = await asset(context, assetId),
        file = await stored(value);
      if (!file)
        throw failure(
          404,
          "VISUAL_FILE_PENDING",
          "L’image n’a pas encore terminé son envoi.",
          true,
        );
      const descriptor =
        variant === "source" ? file.manifest.source : file.manifest.preview;
      const bytes = await storage.read(
        variant === "source" ? file.sourceKey : file.previewKey,
        descriptor.sizeBytes,
      );
      if (
        !bytes ||
        bytes.byteLength !== descriptor.sizeBytes ||
        visualBytesHash(bytes) !== descriptor.contentHash
      )
        throw failure(
          503,
          "VISUAL_FILE_UNAVAILABLE",
          "Cette image ne peut pas être relue. Réessayez plus tard.",
          true,
        );
      await asset(context, assetId);
      return {
        bytes,
        mimeType: descriptor.mimeType,
        contentHash: descriptor.contentHash,
      };
    },
  };
  return service;
}
