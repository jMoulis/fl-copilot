import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
  type SourceBlobStorage,
} from "../src/uploads/source-upload-service.js";

class MemoryCollection {
  readonly documents: Record<string, unknown>[] = [];

  async findOne(query: Record<string, unknown>) {
    return this.documents.find((document) => matches(document, query)) ?? null;
  }

  async insertOne(document: Record<string, unknown>) {
    this.documents.push(structuredClone(document));
    return { acknowledged: true };
  }

  async updateOne(
    query: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
    },
    options?: { upsert?: boolean },
  ) {
    let document = this.documents.find((candidate) =>
      matches(candidate, query),
    );
    if (!document && options?.upsert) {
      document = { ...query, ...update.$setOnInsert };
      this.documents.push(document);
    }
    if (document && update.$set) Object.assign(document, update.$set);
    return { acknowledged: true };
  }
}

class MemoryDatabase implements DatabaseService {
  readonly collections = new Map<string, MemoryCollection>();

  async checkHealth() {
    return "connected" as const;
  }

  async getDb() {
    return {
      collection: (name: string) => {
        let collection = this.collections.get(name);
        if (!collection) {
          collection = new MemoryCollection();
          this.collections.set(name, collection);
        }
        return collection;
      },
    } as unknown as Db;
  }

  async close() {}
}

const storeId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sourceDocumentId = "33333333-3333-4333-8333-333333333333";
const checksum = `sha256:${"a".repeat(64)}`;
const mimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

describe("source upload service", () => {
  it("registers, verifies and confirms one deterministic private blob", async () => {
    const database = new MemoryDatabase();
    let uploaded: SourceBlobMetadata | null = null;
    let issuedUrls = 0;
    const storage: SourceBlobStorage = {
      createUploadUrl: async ({ pathname }) => {
        issuedUrls += 1;
        return `https://blob.example.test/upload?pathname=${encodeURIComponent(pathname)}`;
      },
      head: async () => uploaded,
    };
    const service = createMongoSourceUploadService(
      database,
      storage,
      () => new Date("2026-10-03T12:00:00.000Z"),
    );
    const input = {
      sourceDocumentId,
      sourceType: "MERCALYS_SALES" as const,
      filename: "Ventes été.xlsx",
      mimeType,
      sizeBytes: 27_700,
      checksum,
    };

    const initialized = await service.init(storeId, userId, input);
    expect(initialized).toMatchObject({
      status: "UPLOAD_REQUIRED",
      headers: { "content-type": mimeType },
    });
    expect(initialized.objectKey).toContain(
      `sources/${storeId}/${sourceDocumentId}/${"a".repeat(64)}-Ventes-ete.xlsx`,
    );
    expect(issuedUrls).toBe(1);

    uploaded = {
      pathname: initialized.objectKey,
      size: input.sizeBytes,
      contentType: mimeType,
      url: `https://store.private.blob.vercel-storage.com/${initialized.objectKey}`,
      etag: '"etag-1"',
    };
    await expect(
      service.complete(storeId, initialized.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).resolves.toEqual({
      sourceDocumentId,
      remoteUploadStatus: "CONFIRMED",
      jobId: null,
    });

    await expect(service.init(storeId, userId, input)).resolves.toMatchObject({
      uploadId: initialized.uploadId,
      objectKey: initialized.objectKey,
      status: "ALREADY_UPLOADED",
      uploadUrl: null,
    });
    expect(issuedUrls).toBe(1);
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      _id: sourceDocumentId,
      storeId,
      remoteUploadStatus: "CONFIRMED",
      objectKey: initialized.objectKey,
      blobEtag: '"etag-1"',
    });
  });

  it("normalizes confirmed waste receipt images and retries idempotently", async () => {
    const database = new MemoryDatabase();
    let uploaded: SourceBlobMetadata | null = null;
    let normalizationAttempts = 0;
    let extractionAttempts = 0;
    let arithmeticAttempts = 0;
    let productMatchingAttempts = 0;
    const storage: SourceBlobStorage = {
      createUploadUrl: async ({ pathname }) =>
        `https://blob.example.test/upload?pathname=${encodeURIComponent(pathname)}`,
      head: async () => uploaded,
    };
    const service = createMongoSourceUploadService(
      database,
      storage,
      () => new Date("2026-10-04T17:00:00.000Z"),
      {
        normalize: async () => {
          normalizationAttempts += 1;
          if (normalizationAttempts === 1) {
            throw new Error("NORMALIZATION_TEMPORARILY_UNAVAILABLE");
          }
        },
      },
      {
        extract: async (input) => {
          expect(input).toEqual({ storeId, sourceDocumentId });
          extractionAttempts += 1;
        },
      },
      {
        validate: async (input) => {
          expect(input).toEqual({ storeId, sourceDocumentId });
          arithmeticAttempts += 1;
        },
      },
      {
        match: async (input) => {
          expect(input).toEqual({ storeId, sourceDocumentId });
          productMatchingAttempts += 1;
        },
      },
    );
    const input = {
      sourceDocumentId,
      sourceType: "WASTE_RECEIPT" as const,
      filename: "ticket.heic",
      mimeType: "image/heic" as const,
      sizeBytes: 4096,
      checksum,
    };
    const initialized = await service.init(storeId, userId, input);
    uploaded = {
      pathname: initialized.objectKey,
      size: input.sizeBytes,
      contentType: input.mimeType,
      url: `https://store.private.blob.vercel-storage.com/${initialized.objectKey}`,
      etag: '"etag-receipt"',
    };

    await expect(
      service.complete(storeId, initialized.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).rejects.toThrow("NORMALIZATION_TEMPORARILY_UNAVAILABLE");
    await expect(
      service.complete(storeId, initialized.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).resolves.toMatchObject({ remoteUploadStatus: "CONFIRMED" });
    expect(normalizationAttempts).toBe(2);
    expect(extractionAttempts).toBe(1);
    expect(arithmeticAttempts).toBe(1);
    expect(productMatchingAttempts).toBe(1);
  });
});

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
