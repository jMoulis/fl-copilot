import { get, put } from "@vercel/blob";
import convertHeic from "heic-convert";
import sharp from "sharp";
import type { DatabaseService } from "../database/types.js";

export const WASTE_RECEIPT_NORMALIZER_VERSION = "sharp.receipt.v1";
export const WASTE_RECEIPT_MAX_EDGE = 2048;

export interface NormalizedReceiptImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  contentType: "image/jpeg";
}

export interface ReceiptImageAdapter {
  normalize(bytes: Uint8Array): Promise<NormalizedReceiptImage>;
}

export interface ReceiptImageStorage {
  read(pathname: string): Promise<Uint8Array | null>;
  write(
    pathname: string,
    bytes: Uint8Array,
  ): Promise<{ pathname: string; url: string; etag: string }>;
}

export interface WasteReceiptImageNormalizationService {
  normalize(input: {
    storeId: string;
    sourceDocumentId: string;
    sourceObjectKey: string;
  }): Promise<void>;
}

type RemoteSourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: string;
  remoteUploadStatus: string;
  normalizationStatus?: "READY" | "FAILED";
};

export const sharpReceiptImageAdapter: ReceiptImageAdapter = {
  async normalize(bytes) {
    const input = await sharpCompatibleInput(bytes);
    const result = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({
        width: WASTE_RECEIPT_MAX_EDGE,
        height: WASTE_RECEIPT_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (!result.info.width || !result.info.height) {
      throw new Error("WASTE_RECEIPT_NORMALIZED_DIMENSIONS_MISSING");
    }
    return {
      bytes: new Uint8Array(result.data),
      width: result.info.width,
      height: result.info.height,
      contentType: "image/jpeg",
    };
  },
};

async function sharpCompatibleInput(bytes: Uint8Array) {
  const source = sharp(bytes, { failOn: "error" });
  const metadata = await source.metadata();
  if (metadata.format !== "heif") return bytes;

  const jpeg = await convertHeic({
    buffer: Buffer.from(bytes),
    format: "JPEG",
    quality: 1,
  });
  if (!metadata.orientation || metadata.orientation === 1) return jpeg;
  return sharp(jpeg)
    .withMetadata({ orientation: metadata.orientation })
    .toBuffer();
}

export function createVercelReceiptImageStorage(): ReceiptImageStorage {
  return {
    async read(pathname) {
      const result = await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async write(pathname, bytes) {
      const blob = await put(pathname, Buffer.from(bytes), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/jpeg",
      });
      return { pathname: blob.pathname, url: blob.url, etag: blob.etag };
    },
  };
}

export function createMongoWasteReceiptImageNormalizationService(
  database: DatabaseService,
  storage: ReceiptImageStorage = createVercelReceiptImageStorage(),
  now: () => Date = () => new Date(),
  adapter: ReceiptImageAdapter = sharpReceiptImageAdapter,
): WasteReceiptImageNormalizationService {
  return {
    async normalize(input) {
      const db = await database.getDb();
      const documents =
        db.collection<RemoteSourceDocumentRecord>("sourceDocuments");
      const document = await documents.findOne({
        _id: input.sourceDocumentId,
        storeId: input.storeId,
      });
      if (
        !document ||
        document.sourceType !== "WASTE_RECEIPT" ||
        document.remoteUploadStatus !== "CONFIRMED"
      ) {
        throw new Error("WASTE_RECEIPT_SOURCE_NOT_READY");
      }
      if (document.normalizationStatus === "READY") return;

      const timestamp = now();
      try {
        const original = await storage.read(input.sourceObjectKey);
        if (!original) throw new Error("WASTE_RECEIPT_SOURCE_BLOB_NOT_FOUND");
        const normalized = await adapter.normalize(original);
        const derivativePathname = receiptDerivativeObjectKey(
          input.storeId,
          input.sourceDocumentId,
        );
        const derivative = await storage.write(
          derivativePathname,
          normalized.bytes,
        );
        await documents.updateOne(
          { _id: input.sourceDocumentId, storeId: input.storeId },
          {
            $set: {
              normalizationStatus: "READY",
              normalizerVersion: WASTE_RECEIPT_NORMALIZER_VERSION,
              normalizedObjectKey: derivative.pathname,
              normalizedBlobUrl: derivative.url,
              normalizedBlobEtag: derivative.etag,
              normalizedMimeType: normalized.contentType,
              normalizedSizeBytes: normalized.bytes.byteLength,
              normalizedWidth: normalized.width,
              normalizedHeight: normalized.height,
              normalizationFailureCode: null,
              normalizedAt: timestamp,
              remoteProcessingStatus: "UPLOADED",
              updatedAt: timestamp,
            },
          },
        );
      } catch (error) {
        const failureCode =
          error instanceof Error
            ? error.message.slice(0, 120)
            : "WASTE_RECEIPT_NORMALIZATION_FAILED";
        await documents.updateOne(
          { _id: input.sourceDocumentId, storeId: input.storeId },
          {
            $set: {
              normalizationStatus: "FAILED",
              normalizationFailureCode: failureCode,
              remoteProcessingStatus: "FAILED",
              updatedAt: timestamp,
            },
          },
        );
        throw error;
      }
    },
  };
}

export function receiptDerivativeObjectKey(
  storeId: string,
  sourceDocumentId: string,
) {
  return `derivatives/${storeId}/${sourceDocumentId}/extraction-v1.jpg`;
}
