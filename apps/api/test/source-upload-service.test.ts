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

  it("independently flags an exact receipt checksum without deleting either source", async () => {
    const database = new MemoryDatabase();
    const blobs = new Map<string, SourceBlobMetadata>();
    const storage: SourceBlobStorage = {
      createUploadUrl: async ({ pathname }) =>
        `https://blob.example.test/upload?pathname=${encodeURIComponent(pathname)}`,
      head: async (pathname) => blobs.get(pathname) ?? null,
    };
    const service = createMongoSourceUploadService(
      database,
      storage,
      () => new Date("2026-10-04T18:00:00.000Z"),
      { normalize: async () => undefined },
    );
    const first = await service.init(storeId, userId, {
      sourceDocumentId,
      sourceType: "WASTE_RECEIPT",
      filename: "ticket-1.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4096,
      checksum,
    });
    blobs.set(first.objectKey, {
      pathname: first.objectKey,
      size: 4096,
      contentType: "image/jpeg",
      url: `https://blob.test/${first.objectKey}`,
      etag: '"first"',
    });
    await expect(
      service.complete(storeId, first.uploadId, { checksum, sizeBytes: 4096 }),
    ).resolves.toMatchObject({ wasteReceiptDuplicate: undefined });

    const secondSourceDocumentId = "88888888-8888-4888-8888-888888888888";
    const second = await service.init(storeId, userId, {
      sourceDocumentId: secondSourceDocumentId,
      sourceType: "WASTE_RECEIPT",
      filename: "ticket-2.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4096,
      checksum,
    });
    blobs.set(second.objectKey, {
      pathname: second.objectKey,
      size: 4096,
      contentType: "image/jpeg",
      url: `https://blob.test/${second.objectKey}`,
      etag: '"second"',
    });

    await expect(
      service.complete(storeId, second.uploadId, {
        checksum,
        sizeBytes: 4096,
      }),
    ).resolves.toMatchObject({
      sourceDocumentId: secondSourceDocumentId,
      wasteReceiptDuplicate: {
        status: "POSSIBLE_DUPLICATE",
        reason: "EXACT_IMAGE_CHECKSUM",
        candidateSourceDocumentId: sourceDocumentId,
      },
    });
    expect(database.collections.get("sourceDocuments")?.documents).toHaveLength(
      2,
    );
  });
});

describe("commercial PDF workflow registration", () => {
  const input = {
    sourceDocumentId,
    sourceType: "WEEKLY_COMMERCIAL_PDF" as const,
    filename: "week.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 4096,
    checksum,
  };
  it("registers exactly one job after confirmation and preserves job progress on repeated completion", async () => {
    const database = new MemoryDatabase();
    let blob: SourceBlobMetadata | null = null;
    const service = createMongoSourceUploadService(database, {
      createUploadUrl: async () => "https://blob.example/upload",
      head: async () => blob,
    });
    const init = await service.init(storeId, userId, input);
    await expect(
      service.complete(storeId, init.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).rejects.toThrow();
    expect(
      database.collections.get("commercialDocumentJobs")?.documents ?? [],
    ).toHaveLength(0);
    blob = {
      pathname: init.objectKey,
      size: input.sizeBytes,
      contentType: input.mimeType,
      url: "https://blob.example/private.pdf",
      etag: "etag",
    };
    expect(
      await service.complete(storeId, init.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).toMatchObject({
      jobId: sourceDocumentId,
      remoteUploadStatus: "CONFIRMED",
    });
    const jobs = database.collections.get("commercialDocumentJobs")!.documents;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      _id: sourceDocumentId,
      storeId,
      checksum,
      status: "PENDING",
      stage: "TEXT_EXTRACTION",
      pipelineVersion: "commercial-pdf.v1",
    });
    jobs[0]!.status = "PROCESSING";
    await service.complete(storeId, init.uploadId, {
      checksum,
      sizeBytes: input.sizeBytes,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("PROCESSING");
    await expect(
      service.complete(userId, init.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).rejects.toThrow();
    expect(jobs).toHaveLength(1);
  });
  it("recovers pipeline registration failure after the blob has been confirmed", async () => {
    const database = new MemoryDatabase();
    let objectKey = "";
    const service = createMongoSourceUploadService(database, {
      createUploadUrl: async ({ pathname }) => {
        objectKey = pathname;
        return "https://blob.example/upload";
      },
      head: async () =>
        objectKey
          ? {
              pathname: objectKey,
              size: input.sizeBytes,
              contentType: input.mimeType,
              url: "https://blob.example/private.pdf",
              etag: "etag",
            }
          : null,
    });
    const init = await service.init(storeId, userId, input);
    const jobs = new MemoryCollection();
    database.collections.set("commercialDocumentJobs", jobs);
    const update = jobs.updateOne.bind(jobs);
    let fail = true;
    jobs.updateOne = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error("JOB_REGISTRATION_INTERRUPTED");
      }
      return update(...args);
    };
    await expect(
      service.complete(storeId, init.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).rejects.toThrow("JOB_REGISTRATION_INTERRUPTED");
    expect((await service.init(storeId, userId, input)).status).toBe(
      "ALREADY_UPLOADED",
    );
    expect(
      await service.complete(storeId, init.uploadId, {
        checksum,
        sizeBytes: input.sizeBytes,
      }),
    ).toMatchObject({ jobId: sourceDocumentId });
    expect(jobs.documents).toHaveLength(1);
  });
});

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => {
    if (typeof value === "object" && value !== null && "$ne" in value) {
      return document[key] !== (value as { $ne: unknown }).$ne;
    }
    return document[key] === value;
  });
}
