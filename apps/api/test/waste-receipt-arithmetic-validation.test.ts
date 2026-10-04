import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoWasteReceiptArithmeticValidationService } from "../src/uploads/waste-receipt-arithmetic-validation.js";

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

describe("waste receipt arithmetic validation persistence", () => {
  it("stores one deterministic warning record and leaves extraction values unchanged", async () => {
    const database = readyDatabase();
    const extractionBefore = structuredClone(
      database.collections.get("wasteReceiptExtractions")?.documents[0],
    );
    const service = createMongoWasteReceiptArithmeticValidationService(
      database,
      "0.01",
      () => new Date("2026-10-04T20:00:00.000Z"),
    );

    await service.validate({ storeId, sourceDocumentId });
    await service.validate({ storeId, sourceDocumentId });

    expect(
      database.collections.get("wasteReceiptArithmeticValidations")?.documents,
    ).toHaveLength(1);
    expect(
      database.collections.get("wasteReceiptArithmeticValidations")
        ?.documents[0],
    ).toMatchObject({
      storeId,
      sourceDocumentId,
      extractionId,
      validatorVersion: "waste-receipt.arithmetic.v1",
      tolerance: "0.01",
      result: {
        checkedLineCount: 2,
        consistentLineCount: 1,
        mismatchLineCount: 1,
        uncheckedLineCount: 1,
        hasWarnings: true,
        lines: [
          { sourceLineIndex: 0, status: "CONSISTENT" },
          {
            sourceLineIndex: 1,
            status: "MISMATCH",
            expectedTotal: "2.89",
            observedTotal: "3.20",
            warningCode: "AMOUNT_TO_REVIEW",
          },
          { sourceLineIndex: 2, status: "NOT_CHECKED" },
        ],
      },
    });
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      arithmeticValidationStatus: "READY",
      arithmeticValidatorVersion: "waste-receipt.arithmetic.v1",
      arithmeticWarningCount: 1,
      arithmeticUncheckedLineCount: 1,
      remoteProcessingStatus: "TO_VALIDATE",
    });
    expect(
      database.collections.get("wasteReceiptExtractions")?.documents[0],
    ).toEqual(extractionBefore);
  });

  it("fails closed when the extraction evidence is unavailable", async () => {
    const database = readyDatabase();
    database.collections.get("wasteReceiptExtractions")!.documents.length = 0;
    const service = createMongoWasteReceiptArithmeticValidationService(
      database,
      "0.01",
    );

    await expect(
      service.validate({ storeId, sourceDocumentId }),
    ).rejects.toThrow("WASTE_RECEIPT_EXTRACTION_NOT_FOUND");
    expect(
      database.collections.get("wasteReceiptArithmeticValidations")?.documents,
    ).toHaveLength(0);
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
  });
  database.collections.set("sourceDocuments", documents);
  const extractions = new MemoryCollection();
  extractions.documents.push({
    _id: extractionId,
    storeId,
    sourceDocumentId,
    output: {
      lines: [
        {
          sourceLineIndex: 0,
          weight: 0.58,
          unitPrice: 4.99,
          totalPrice: 2.89,
        },
        {
          sourceLineIndex: 1,
          weight: 0.58,
          unitPrice: 4.99,
          totalPrice: 3.2,
        },
        {
          sourceLineIndex: 2,
          weight: null,
          unitPrice: 2.5,
          totalPrice: null,
        },
      ],
    },
  });
  database.collections.set("wasteReceiptExtractions", extractions);
  return database;
}

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
