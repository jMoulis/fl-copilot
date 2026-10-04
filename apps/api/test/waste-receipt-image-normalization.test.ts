import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import {
  WASTE_RECEIPT_MAX_EDGE,
  WASTE_RECEIPT_NORMALIZER_VERSION,
  createMongoWasteReceiptImageNormalizationService,
  receiptDerivativeObjectKey,
  sharpReceiptImageAdapter,
  type ReceiptImageStorage,
} from "../src/uploads/waste-receipt-image-normalization.js";

class MemoryCollection {
  readonly documents: Record<string, unknown>[] = [];

  async findOne(query: Record<string, unknown>) {
    return this.documents.find((document) => matches(document, query)) ?? null;
  }

  async updateOne(
    query: Record<string, unknown>,
    update: { $set?: Record<string, unknown> },
  ) {
    const document = this.documents.find((candidate) =>
      matches(candidate, query),
    );
    if (document && update.$set) Object.assign(document, update.$set);
    return { acknowledged: true };
  }
}

class MemoryDatabase implements DatabaseService {
  readonly documents = new MemoryCollection();

  async checkHealth() {
    return "connected" as const;
  }

  async getDb() {
    return {
      collection: () => this.documents,
    } as unknown as Db;
  }

  async close() {}
}

const storeId = "11111111-1111-4111-8111-111111111111";
const sourceDocumentId = "22222222-2222-4222-8222-222222222222";
const sourceObjectKey = `sources/${storeId}/${sourceDocumentId}/ticket.jpg`;
const pilotHeicFixture = new URL(
  "../../../docs/files_examples/casse%20vrac%20ticket%20example.heic",
  import.meta.url,
);

describe("waste receipt image normalization", () => {
  it.skipIf(!existsSync(pilotHeicFixture))(
    "normalizes the optional real HEIC waste ticket fixture",
    async () => {
      const fixture = await readFile(pilotHeicFixture);
      const normalized = await sharpReceiptImageAdapter.normalize(fixture);
      const metadata = await sharp(normalized.bytes).metadata();

      expect(metadata.format).toBe("jpeg");
      expect(Math.max(normalized.width, normalized.height)).toBe(
        WASTE_RECEIPT_MAX_EDGE,
      );
    },
  );

  it("applies EXIF orientation and produces a bounded extraction JPEG", async () => {
    const portraitByOrientation = await sharp({
      create: {
        width: 3000,
        height: 1000,
        channels: 3,
        background: "#eeeeee",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const normalized = await sharpReceiptImageAdapter.normalize(
      new Uint8Array(portraitByOrientation),
    );
    const metadata = await sharp(normalized.bytes).metadata();

    expect(normalized.contentType).toBe("image/jpeg");
    expect(normalized.width).toBeLessThanOrEqual(WASTE_RECEIPT_MAX_EDGE);
    expect(normalized.height).toBe(WASTE_RECEIPT_MAX_EDGE);
    expect(normalized.width).toBeLessThan(normalized.height);
    expect(metadata.orientation).toBeUndefined();
  });

  it("stores one private extraction derivative and reuses its durable evidence", async () => {
    const database = new MemoryDatabase();
    database.documents.documents.push({
      _id: sourceDocumentId,
      storeId,
      sourceType: "WASTE_RECEIPT",
      remoteUploadStatus: "CONFIRMED",
    });
    const original = new Uint8Array([1, 2, 3]);
    let reads = 0;
    let writes = 0;
    const storage: ReceiptImageStorage = {
      read: async (pathname) => {
        expect(pathname).toBe(sourceObjectKey);
        reads += 1;
        return original;
      },
      write: async (pathname, bytes) => {
        expect(pathname).toBe(
          receiptDerivativeObjectKey(storeId, sourceDocumentId),
        );
        expect(bytes).toEqual(new Uint8Array([4, 5, 6]));
        writes += 1;
        return { pathname, url: "private://normalized", etag: "etag-2" };
      },
    };
    const service = createMongoWasteReceiptImageNormalizationService(
      database,
      storage,
      () => new Date("2026-10-04T17:00:00.000Z"),
      {
        normalize: async (bytes) => {
          expect(bytes).toEqual(original);
          return {
            bytes: new Uint8Array([4, 5, 6]),
            width: 1200,
            height: 1800,
            contentType: "image/jpeg",
          };
        },
      },
    );

    await service.normalize({ storeId, sourceDocumentId, sourceObjectKey });
    await service.normalize({ storeId, sourceDocumentId, sourceObjectKey });

    expect(reads).toBe(1);
    expect(writes).toBe(1);
    expect(database.documents.documents[0]).toMatchObject({
      normalizationStatus: "READY",
      normalizerVersion: WASTE_RECEIPT_NORMALIZER_VERSION,
      normalizedObjectKey: receiptDerivativeObjectKey(
        storeId,
        sourceDocumentId,
      ),
      normalizedMimeType: "image/jpeg",
      normalizedSizeBytes: 3,
      normalizedWidth: 1200,
      normalizedHeight: 1800,
      normalizationFailureCode: null,
      remoteProcessingStatus: "UPLOADED",
    });
  });

  it("records a retryable failure without discarding the original", async () => {
    const database = new MemoryDatabase();
    database.documents.documents.push({
      _id: sourceDocumentId,
      storeId,
      sourceType: "WASTE_RECEIPT",
      remoteUploadStatus: "CONFIRMED",
    });
    const service = createMongoWasteReceiptImageNormalizationService(
      database,
      {
        read: async () => null,
        write: async () => {
          throw new Error("must not write");
        },
      },
      () => new Date("2026-10-04T17:00:00.000Z"),
    );

    await expect(
      service.normalize({ storeId, sourceDocumentId, sourceObjectKey }),
    ).rejects.toThrow("WASTE_RECEIPT_SOURCE_BLOB_NOT_FOUND");
    expect(database.documents.documents[0]).toMatchObject({
      normalizationStatus: "FAILED",
      normalizationFailureCode: "WASTE_RECEIPT_SOURCE_BLOB_NOT_FOUND",
      remoteProcessingStatus: "FAILED",
    });
  });
});

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
