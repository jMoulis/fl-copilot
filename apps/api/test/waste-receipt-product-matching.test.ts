import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type {
  Product,
  ProductAlias,
  ProductMatchCatalog,
} from "@fl-copilot/domain";
import { normalizeProductLabel } from "@fl-copilot/domain";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoWasteReceiptProductMatchingService } from "../src/uploads/waste-receipt-product-matching.js";

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
const extractionId = "33333333-3333-4333-8333-333333333333";
const bulkId = "44444444-4444-4444-8444-444444444444";
const packagedId = "55555555-5555-4555-8555-555555555555";
const tomatoRedId = "66666666-6666-4666-8666-666666666666";
const tomatoBlackId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-10-04T20:00:00.000Z";

describe("waste receipt product matching", () => {
  it("keeps bulk and packaged matches together and preserves ambiguous lines", async () => {
    const database = readyDatabase();
    const catalog = productCatalog();
    const service = createMongoWasteReceiptProductMatchingService(
      database,
      { load: async () => catalog },
      () => new Date(timestamp),
    );

    await service.match({ storeId, sourceDocumentId });
    await service.match({ storeId, sourceDocumentId });

    const records = database.collections.get(
      "wasteReceiptProductMatches",
    )?.documents;
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      storeId,
      sourceDocumentId,
      extractionId,
      engineVersion: "product-matcher-v1",
      summary: {
        matchedLineCount: 2,
        reviewLineCount: 0,
        ambiguousLineCount: 1,
        unmatchedLineCount: 1,
        bulkMatchedLineCount: 1,
        packagedMatchedLineCount: 1,
        unknownNatureMatchedLineCount: 0,
      },
      lines: [
        {
          sourceLineIndex: 0,
          matchResult: { state: "AUTO_MATCH", matchedProductId: bulkId },
          matchedProduct: { productId: bulkId, nature: "BULK" },
        },
        {
          sourceLineIndex: 1,
          matchResult: { state: "AUTO_MATCH", matchedProductId: packagedId },
          matchedProduct: { productId: packagedId, nature: "PACKAGED" },
        },
        {
          sourceLineIndex: 2,
          matchResult: { state: "AMBIGUOUS", matchedProductId: null },
          matchedProduct: null,
          candidates: [
            { productId: tomatoRedId, nature: "BULK" },
            { productId: tomatoBlackId, nature: "BULK" },
          ],
        },
        {
          sourceLineIndex: 3,
          matchResult: { state: "NO_MATCH", matchedProductId: null },
          matchedProduct: null,
        },
      ],
    });
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      productMatchingStatus: "READY",
      productMatcherVersion: "product-matcher-v1",
      productMatchedLineCount: 2,
      productReviewLineCount: 1,
      productUnmatchedLineCount: 1,
      remoteProcessingStatus: "TO_VALIDATE",
    });
  });

  it("creates new evidence when the product catalog revision changes", async () => {
    const database = readyDatabase();
    const catalog = productCatalog();
    let version = 1;
    const service = createMongoWasteReceiptProductMatchingService(database, {
      load: async () => ({
        ...catalog,
        products: catalog.products.map((product) => ({
          ...product,
          version,
        })),
      }),
    });

    await service.match({ storeId, sourceDocumentId });
    version = 2;
    await service.match({ storeId, sourceDocumentId });

    const records = database.collections.get(
      "wasteReceiptProductMatches",
    )?.documents;
    expect(records).toHaveLength(2);
    expect(records?.[0]?.catalogFingerprint).not.toBe(
      records?.[1]?.catalogFingerprint,
    );
    expect(
      database.collections.get("sourceDocuments")?.documents[0]
        ?.productMatchingId,
    ).toBe(records?.[1]?._id);
  });

  it("records a retryable failure without inventing a product", async () => {
    const database = readyDatabase();
    database.collections.get("wasteReceiptExtractions")!.documents.length = 0;
    const service = createMongoWasteReceiptProductMatchingService(database, {
      load: async () => productCatalog(),
    });

    await expect(service.match({ storeId, sourceDocumentId })).rejects.toThrow(
      "WASTE_RECEIPT_EXTRACTION_NOT_FOUND",
    );
    expect(
      database.collections.get("wasteReceiptProductMatches")?.documents,
    ).toHaveLength(0);
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      productMatchingStatus: "FAILED",
      productMatchingFailureCode: "WASTE_RECEIPT_EXTRACTION_NOT_FOUND",
      remoteProcessingStatus: "FAILED",
    });
  });
});

function readyDatabase() {
  const database = new MemoryDatabase();
  const documents = new MemoryCollection();
  documents.documents.push({
    _id: sourceDocumentId,
    storeId,
    sourceType: "WASTE_RECEIPT",
    extractionStatus: "READY",
    extractionId,
    arithmeticValidationStatus: "READY",
  });
  database.collections.set("sourceDocuments", documents);
  const extractions = new MemoryCollection();
  extractions.documents.push({
    _id: extractionId,
    storeId,
    sourceDocumentId,
    output: {
      lines: [
        { sourceLineIndex: 0, rawLabel: "BANANE VRAC" },
        { sourceLineIndex: 1, rawLabel: "FIGUE BARQUETTE" },
        { sourceLineIndex: 2, rawLabel: "TOMATE" },
        { sourceLineIndex: 3, rawLabel: "ZZQX VBNM" },
      ],
    },
  });
  database.collections.set("wasteReceiptExtractions", extractions);
  return database;
}

function productCatalog(): ProductMatchCatalog {
  const products = [
    product(bulkId, "BANANE VRAC", "BULK", "KG"),
    product(packagedId, "FIGUE BARQUETTE", "PACKAGED", "PACK"),
    product(tomatoRedId, "TOMATE ROUGE", "BULK", "KG"),
    product(tomatoBlackId, "TOMATE NOIRE", "BULK", "KG"),
  ];
  return {
    products,
    identifiers: [],
    aliases: [
      alias("88888888-8888-4888-8888-888888888888", tomatoRedId, "TOMATE"),
      alias("99999999-9999-4999-8999-999999999999", tomatoBlackId, "TOMATE"),
    ],
  };
}

function product(
  id: string,
  label: string,
  nature: Product["nature"],
  salesUnit: Product["salesUnit"],
): Product {
  return {
    id,
    storeId,
    label,
    category: "FRUIT",
    nature,
    salesUnit,
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function alias(id: string, productId: string, value: string): ProductAlias {
  return {
    id,
    storeId,
    productId,
    alias: value,
    normalizedAlias: normalizeProductLabel(value),
    source: "WASTE_RECEIPT",
    status: "VALIDATED",
    confidence: 1,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
