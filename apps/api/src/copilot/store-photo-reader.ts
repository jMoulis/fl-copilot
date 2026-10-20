import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import sharp from "sharp";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import {
  MAX_STORE_PHOTO_BYTES,
  MAX_STORE_PHOTO_PIXELS,
  MAX_STORE_PHOTO_FRAME_BYTES,
  detectVisualImageMime,
  storePhotoMimeSchema,
  storePhotoReadInputSchema,
  storePhotoSnapshotSchema,
  type StorePhotoSnapshot,
} from "@fl-copilot/domain";
import { sourceObjectKey } from "../uploads/source-upload-service";
import { sharpCompatibleInput } from "../uploads/waste-receipt-image-normalization";

const hash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceSchema = z.object({
  _id: z.uuid(),
  storeId: z.uuid(),
  sourceType: z.literal("STORE_PHOTO"),
  originalFilename: z.string().min(1).max(240),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(1).max(MAX_STORE_PHOTO_BYTES),
  mimeType: storePhotoMimeSchema,
  objectKey: z.string(),
  createdAt: z.date(),
});
export type StorePhotoRead = {
  snapshot: StorePhotoSnapshot;
  image: Uint8Array;
};
export type StorePhotoBlobReader = (
  key: string,
  maximumBytes: number,
  signal?: AbortSignal,
) => Promise<Uint8Array | null>;
const checkSignal = (signal?: AbortSignal) => {
  if (signal?.aborted) throw Error("STORE_PHOTO_READ_CANCELLED");
};

/** No URL or model-controlled path; stop the private stream at the declared source size. */
export const readPrivateStorePhoto: StorePhotoBlobReader = async (
  key,
  maximumBytes,
  signal,
) => {
  checkSignal(signal);
  const response = await get(key, {
    access: "private",
    ...(signal ? { abortSignal: signal } : {}),
  });
  if (!response || response.statusCode !== 200) return null;
  const reader = response.stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      checkSignal(signal);
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes || size > MAX_STORE_PHOTO_BYTES)
        throw Error("STORE_PHOTO_INVALID");
      parts.push(part.value);
    }
    return new Uint8Array(Buffer.concat(parts));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

export async function normalizeStorePhoto(
  bytes: Uint8Array,
  expected: {
    checksum: string;
    sizeBytes: number;
    mimeType: z.infer<typeof storePhotoMimeSchema>;
  },
) {
  if (
    !bytes.length ||
    bytes.length !== expected.sizeBytes ||
    bytes.length > MAX_STORE_PHOTO_BYTES ||
    hash(bytes) !== expected.checksum ||
    detectVisualImageMime(bytes) !== expected.mimeType
  )
    throw Error("STORE_PHOTO_INVALID");
  try {
    const meta = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_STORE_PHOTO_PIXELS,
    }).metadata();
    if (
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1 ||
      meta.width * meta.height > MAX_STORE_PHOTO_PIXELS
    )
      throw Error("STORE_PHOTO_INVALID");
    const compatible = await sharpCompatibleInput(bytes);
    const normalized = await sharp(compatible, {
      failOn: "error",
      limitInputPixels: MAX_STORE_PHOTO_PIXELS,
    })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (
      !normalized.info.width ||
      !normalized.info.height ||
      normalized.data.length > MAX_STORE_PHOTO_FRAME_BYTES
    )
      throw Error("STORE_PHOTO_INVALID");
    return {
      image: new Uint8Array(normalized.data),
      frame: {
        checksum: hash(normalized.data),
        mimeType: "image/jpeg" as const,
        width: normalized.info.width,
        height: normalized.info.height,
        sizeBytes: normalized.data.length,
      },
    };
  } catch {
    throw Error("STORE_PHOTO_INVALID");
  }
}

/** Scope is supplied by the authenticated turn, never by model arguments. */
export async function readStorePhoto(
  db: Db,
  rawScope: { storeId: string; ownerId: string },
  raw: unknown,
  readBlob: StorePhotoBlobReader = readPrivateStorePhoto,
  signal?: AbortSignal,
): Promise<StorePhotoRead> {
  const scope = z
      .strictObject({ storeId: z.uuid(), ownerId: z.uuid() })
      .parse(rawScope),
    input = storePhotoReadInputSchema.parse(raw);
  const lookup = async () => {
    checkSignal(signal);
    const [row, upload] = await Promise.all([
      db.collection<Document & { _id: string }>("sourceDocuments").findOne(
        {
          _id: input.sourceDocumentId,
          storeId: scope.storeId,
          sourceType: "STORE_PHOTO",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      ),
      db.collection("sourceUploads").findOne(
        {
          storeId: scope.storeId,
          userId: scope.ownerId,
          sourceDocumentId: input.sourceDocumentId,
          sourceType: "STORE_PHOTO",
          status: "CONFIRMED",
        },
        { maxTimeMS: 2000 },
      ),
    ]);
    checkSignal(signal);
    if (!row || !upload) throw Error("STORE_PHOTO_UNAVAILABLE");
    const source = sourceSchema.parse(row),
      expectedKey = sourceObjectKey(scope.storeId, {
        sourceDocumentId: source._id,
        sourceType: "STORE_PHOTO",
        filename: source.originalFilename,
        checksum: source.checksum,
        sizeBytes: source.sizeBytes,
        mimeType: source.mimeType,
      });
    if (
      source._id !== input.sourceDocumentId ||
      source.storeId !== scope.storeId ||
      source.objectKey !== expectedKey ||
      upload.storeId !== scope.storeId ||
      upload.userId !== scope.ownerId ||
      upload.sourceDocumentId !== source._id ||
      upload.sourceType !== "STORE_PHOTO" ||
      upload.status !== "CONFIRMED" ||
      upload.objectKey !== expectedKey ||
      upload.checksum !== source.checksum ||
      upload.sizeBytes !== source.sizeBytes ||
      upload.mimeType !== source.mimeType ||
      upload.filename !== source.originalFilename
    )
      throw Error("STORE_PHOTO_INVALID");
    return source;
  };
  const source = await lookup(),
    bytes = await readBlob(source.objectKey, source.sizeBytes, signal);
  checkSignal(signal);
  if (!bytes) throw Error("STORE_PHOTO_UNAVAILABLE");
  const { image, frame } = await normalizeStorePhoto(bytes, source);
  const current = await lookup();
  if (JSON.stringify(current) !== JSON.stringify(source))
    throw Error("STORE_PHOTO_CHANGED");
  return {
    image,
    snapshot: storePhotoSnapshotSchema.parse({
      status: "AVAILABLE",
      source: {
        sourceDocumentId: source._id,
        sourceType: "STORE_PHOTO",
        filename: source.originalFilename,
        checksum: source.checksum,
        registeredAt: source.createdAt.toISOString(),
      },
      frame,
      evidence: [
        {
          id: `store-photo/${source._id}/${source.checksum.slice(7)}`,
          sourceType: "SOURCE_DOCUMENT",
          sourceId: source._id,
          sourceVersion: null,
          label: "Photo du rayon — original consulté",
          value:
            "Photo disponible pour une lecture visuelle du copilote, à confirmer sur le terrain.",
          detail:
            "Le fichier original est conservé. L’image ne confirme aucun stock, identité produit, prix, dimension, date métier ou réalisation. Les chiffres officiels restent issus des outils du magasin.",
          factKind: "QUALITY",
        },
      ],
    }),
  };
}
