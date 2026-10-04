import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintMercalysRecords } from "@fl-copilot/import-core";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import {
  createMongoImportVerificationService,
  type RemoteMercalysParser,
} from "../src/imports/import-verification-service.js";

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
const sourceDocumentId = "22222222-2222-4222-8222-222222222222";
const bytes = new TextEncoder().encode("private workbook bytes");
const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const records = [
  {
    sourceIndex: 4,
    itm8: "00001234",
    ean: null,
    rawLabel: "POIRE CONFERENCE VRAC",
    businessDate: "2026-09-26",
    quantity: 1.82,
    purchaseValue: null,
    rceValue: null,
    salesValue: 4.5,
    vatValue: null,
    marginValue: null,
    marginRate: null,
    rawValues: {
      itm8: "00001234",
      ean: null,
      rawLabel: "POIRE CONFERENCE VRAC",
      businessDate: "26/09/2026",
      quantity: "1,82",
      purchaseValue: null,
      rceValue: null,
      salesValue: "4,50",
      vatValue: null,
      marginValue: null,
      marginRate: null,
    },
  },
];

function parser(
  overrides: Partial<ReturnType<RemoteMercalysParser["parse"]>> = {},
) {
  return {
    parse: () => ({
      parserVersion: "mercalys-sales.article.v1",
      businessPeriodStart: "2026-09-26",
      businessPeriodEnd: "2026-09-26",
      records,
      ...overrides,
    }),
  } satisfies RemoteMercalysParser;
}

function fixture(
  remoteParser = parser(),
  reader: () => Promise<Uint8Array | null> = async () => bytes,
) {
  const database = new MemoryDatabase();
  const documents = new MemoryCollection();
  documents.documents.push({
    _id: sourceDocumentId,
    storeId,
    sourceType: "MERCALYS_SALES",
    checksum,
    remoteUploadStatus: "CONFIRMED",
    objectKey: `sources/${storeId}/${sourceDocumentId}/sales.xlsx`,
  });
  database.collections.set("sourceDocuments", documents);
  const service = createMongoImportVerificationService(
    database,
    { read: reader },
    () => new Date("2026-10-03T20:00:00.000Z"),
    remoteParser,
  );
  return { database, documents, service };
}

const request = {
  sourceType: "MERCALYS_SALES" as const,
  checksum,
  businessPeriodStart: "2026-09-26",
  businessPeriodEnd: "2026-09-26",
  localNormalizedFingerprint: fingerprintMercalysRecords(records),
  localRecordCount: 1,
};

describe("remote import verification", () => {
  it("returns MATCH and stores the remote parser evidence", async () => {
    const { documents, service } = fixture();
    await expect(
      service.verify(storeId, sourceDocumentId, request),
    ).resolves.toMatchObject({
      sourceDocumentId,
      status: "MATCH",
      localFingerprint: request.localNormalizedFingerprint,
      remoteFingerprint: request.localNormalizedFingerprint,
    });
    expect(documents.documents[0]).toMatchObject({
      verificationStatus: "MATCH",
      remoteRecordCount: 1,
      remoteParserVersion: "mercalys-sales.article.v1",
      remoteProcessingStatus: "PUBLISHED",
      verificationFailureCode: null,
    });
  });

  it("returns DIFFERENCE without replacing the local fingerprint", async () => {
    const { documents, service } = fixture(
      parser({ records: [{ ...records[0]!, quantity: 2 }] }),
    );
    await expect(
      service.verify(storeId, sourceDocumentId, request),
    ).resolves.toMatchObject({
      status: "DIFFERENCE",
      localFingerprint: request.localNormalizedFingerprint,
    });
    expect(documents.documents[0]).toMatchObject({
      verificationStatus: "DIFFERENCE",
      remoteProcessingStatus: "RECONCILING",
    });
  });

  it("returns FAILED when the private file cannot be parsed", async () => {
    const { documents, service } = fixture({
      parse: () => {
        throw new Error("MERCALYS_FORMAT_UNSUPPORTED");
      },
    });
    await expect(
      service.verify(storeId, sourceDocumentId, request),
    ).resolves.toMatchObject({ status: "FAILED", remoteFingerprint: null });
    expect(documents.documents[0]).toMatchObject({
      verificationStatus: "FAILED",
      remoteProcessingStatus: "FAILED",
      verificationFailureCode: "MERCALYS_FORMAT_UNSUPPORTED",
    });
  });

  it("lets transient Blob read failures reach the queue retry path", async () => {
    const { documents, service } = fixture(parser(), async () => {
      throw new Error("BLOB_NETWORK_UNAVAILABLE");
    });
    await expect(
      service.verify(storeId, sourceDocumentId, request),
    ).rejects.toThrow("BLOB_NETWORK_UNAVAILABLE");
    expect(documents.documents[0]).not.toHaveProperty("verificationStatus");
  });
});

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
