import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoWasteReceiptDraftReader } from "../src/uploads/waste-receipt-draft.js";

class MemoryCollection {
  readonly documents: Record<string, unknown>[] = [];

  async findOne(query: Record<string, unknown>) {
    return (
      this.documents.find((document) =>
        Object.entries(query).every(([key, value]) => document[key] === value),
      ) ?? null
    );
  }
}

class MemoryDatabase implements DatabaseService {
  readonly collections = new Map<string, MemoryCollection>();

  async checkHealth() {
    return "connected" as const;
  }

  async getDb() {
    return {
      collection: (name: string) => this.collections.get(name),
    } as unknown as Db;
  }

  async close() {}
}

const storeId = "11111111-1111-4111-8111-111111111111";
const sourceDocumentId = "22222222-2222-4222-8222-222222222222";
const extractionId = "33333333-3333-4333-8333-333333333333";
const arithmeticId = "44444444-4444-4444-8444-444444444444";
const matchingId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const candidateId = "77777777-7777-4777-8777-777777777777";

describe("waste receipt draft reader", () => {
  it("assembles stable mobile lines from extraction, arithmetic, and matching evidence", async () => {
    const database = readyDatabase();
    const reader = createMongoWasteReceiptDraftReader(database);

    const first = await reader.read({ storeId, sourceDocumentId });
    const second = await reader.read({ storeId, sourceDocumentId });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      detectedReceiptDate: "2026-09-26",
      detectedCashierNumber: "000007",
      extractionModelVersion: "gpt-5.4-mini",
      arithmeticValidatorVersion: "receipt-arithmetic-v1",
      productMatcherVersion: "product-matcher-v1",
      lines: [
        {
          sourceLineIndex: 0,
          rawLabel: "BANANE VRAC",
          weight: "1.82",
          quantityUnit: "KG",
          unitPrice: "2.5",
          totalPrice: "4.55",
          arithmeticStatus: "CONSISTENT",
          matchState: "AUTO_MATCH",
          matchedProductId: productId,
          productNature: "BULK",
          validationStatus: "PENDING",
        },
        {
          sourceLineIndex: 1,
          rawLabel: "TOMATE",
          quantity: "3",
          quantityUnit: "PIECE",
          arithmeticStatus: "MISMATCH",
          arithmeticWarningCode: "AMOUNT_TO_REVIEW",
          matchState: "AMBIGUOUS",
          matchedProductId: null,
          candidates: [{ productId: candidateId }],
          validationStatus: "TO_REVIEW",
        },
      ],
    });
    expect(first.lines[0]?.lineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.lines[0]?.lineId).not.toBe(first.lines[1]?.lineId);
  });
});

function readyDatabase() {
  const database = new MemoryDatabase();
  add(database, "sourceDocuments", {
    _id: sourceDocumentId,
    storeId,
    sourceType: "WASTE_RECEIPT",
    extractionId,
    arithmeticValidationId: arithmeticId,
    productMatchingId: matchingId,
  });
  add(database, "wasteReceiptExtractions", {
    _id: extractionId,
    storeId,
    sourceDocumentId,
    resolvedModel: "gpt-5.4-mini",
    output: {
      detectedReceiptDate: "2026-09-26",
      cashierNumber: "000007",
      lines: [
        {
          sourceLineIndex: 0,
          rawLabel: "BANANE VRAC",
          quantity: null,
          weight: 1.82,
          quantityUnit: "kg",
          unitPrice: 2.5,
          totalPrice: 4.55,
          extractionConfidence: { label: 0.99 },
          sourceRegion: null,
        },
        {
          sourceLineIndex: 1,
          rawLabel: "TOMATE",
          quantity: 3,
          weight: null,
          quantityUnit: "pièce",
          unitPrice: 1,
          totalPrice: 2,
          extractionConfidence: { label: 0.8 },
          sourceRegion: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
        },
      ],
    },
  });
  add(database, "wasteReceiptArithmeticValidations", {
    _id: arithmeticId,
    storeId,
    sourceDocumentId,
    validatorVersion: "receipt-arithmetic-v1",
    result: {
      lines: [
        {
          sourceLineIndex: 0,
          status: "CONSISTENT",
          expectedTotal: "4.55",
          absoluteDifference: "0",
          warningCode: null,
        },
        {
          sourceLineIndex: 1,
          status: "MISMATCH",
          expectedTotal: "3",
          absoluteDifference: "1",
          warningCode: "AMOUNT_TO_REVIEW",
        },
      ],
    },
  });
  add(database, "wasteReceiptProductMatches", {
    _id: matchingId,
    storeId,
    sourceDocumentId,
    engineVersion: "product-matcher-v1",
    lines: [
      {
        sourceLineIndex: 0,
        matchResult: {
          state: "AUTO_MATCH",
          matchedProductId: productId,
          candidates: [{ score: 0.98 }],
        },
        matchedProduct: {
          productId,
          label: "BANANE VRAC",
          nature: "BULK",
        },
        candidates: [],
      },
      {
        sourceLineIndex: 1,
        matchResult: {
          state: "AMBIGUOUS",
          matchedProductId: null,
          candidates: [{ score: 0.72 }],
        },
        matchedProduct: null,
        candidates: [
          {
            productId: candidateId,
            label: "TOMATE ROUGE VRAC",
            nature: "BULK",
            salesUnit: "KG",
            score: 0.72,
          },
        ],
      },
    ],
  });
  return database;
}

function add(
  database: MemoryDatabase,
  collectionName: string,
  document: Record<string, unknown>,
) {
  const collection = new MemoryCollection();
  collection.documents.push(document);
  database.collections.set(collectionName, collection);
}
