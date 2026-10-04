import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { DatabaseService } from "../src/database/types.js";
import {
  WASTE_RECEIPT_VISION_SCHEMA_VERSION,
  createMongoWasteReceiptVisionExtractionService,
  createOpenAIReceiptVisionProvider,
  type ReceiptVisionProvider,
} from "../src/uploads/waste-receipt-vision-extraction.js";

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
const normalizedObjectKey = `derivatives/${storeId}/${sourceDocumentId}/extraction-v1.jpg`;
const image = new Uint8Array([1, 2, 3]);

const validOutput = {
  detectedReceiptDate: "2026-10-04",
  lines: [
    {
      sourceLineIndex: 0,
      rawLabel: "BANANE VRAC",
      quantity: null,
      weight: 1.24,
      quantityUnit: "kg",
      unitPrice: 1.99,
      totalPrice: 2.47,
      extractionConfidence: {
        label: 0.99,
        quantity: 0.94,
        unitPrice: 0.96,
        totalPrice: 0.98,
      },
      sourceRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.08 },
    },
  ],
};

describe("waste receipt Vision extraction", () => {
  it("persists schema-valid evidence once and marks it ready for review", async () => {
    const database = readyDatabase();
    let reads = 0;
    let providerCalls = 0;
    const provider = providerReturning(async () => {
      providerCalls += 1;
      return validOutput;
    });
    const service = createMongoWasteReceiptVisionExtractionService(
      database,
      provider,
      {
        read: async (pathname) => {
          expect(pathname).toBe(normalizedObjectKey);
          reads += 1;
          return image;
        },
      },
      () => new Date("2026-10-04T19:00:00.000Z"),
    );

    await service.extract({ storeId, sourceDocumentId });
    await service.extract({ storeId, sourceDocumentId });

    expect(reads).toBe(1);
    expect(providerCalls).toBe(1);
    expect(
      database.collections.get("wasteReceiptExtractions")?.documents,
    ).toHaveLength(1);
    expect(
      database.collections.get("wasteReceiptExtractions")?.documents[0],
    ).toMatchObject({
      storeId,
      sourceDocumentId,
      provider: "test-vision",
      model: "test-model",
      resolvedModel: "test-model-2026-10-01",
      schemaVersion: WASTE_RECEIPT_VISION_SCHEMA_VERSION,
      output: validOutput,
    });
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      extractionStatus: "READY",
      extractionProvider: "test-vision",
      extractionModelVersion: "test-model-2026-10-01",
      extractionSchemaVersion: WASTE_RECEIPT_VISION_SCHEMA_VERSION,
      extractionFailureCode: null,
      remoteProcessingStatus: "TO_VALIDATE",
    });
  });

  it("rejects invalid provider output before it reaches extraction state", async () => {
    const database = readyDatabase();
    const service = createMongoWasteReceiptVisionExtractionService(
      database,
      providerReturning(async () => ({
        ...validOutput,
        lines: [{ ...validOutput.lines[0], totalPrice: -2.47 }],
      })),
      { read: async () => image },
    );

    await expect(
      service.extract({ storeId, sourceDocumentId }),
    ).rejects.toThrow("WASTE_RECEIPT_VISION_SCHEMA_INVALID");
    expect(
      database.collections.get("wasteReceiptExtractions")?.documents,
    ).toHaveLength(0);
    expect(
      database.collections.get("sourceDocuments")?.documents[0],
    ).toMatchObject({
      extractionStatus: "FAILED",
      extractionFailureCode: "WASTE_RECEIPT_VISION_SCHEMA_INVALID",
      remoteProcessingStatus: "FAILED",
    });
  });

  it("rejects duplicate source indexes so repeated lines stay distinct", async () => {
    const database = readyDatabase();
    const service = createMongoWasteReceiptVisionExtractionService(
      database,
      providerReturning(async () => ({
        ...validOutput,
        lines: [validOutput.lines[0], { ...validOutput.lines[0] }],
      })),
      { read: async () => image },
    );

    await expect(
      service.extract({ storeId, sourceDocumentId }),
    ).rejects.toThrow("WASTE_RECEIPT_VISION_SCHEMA_INVALID");
    expect(
      database.collections.get("wasteReceiptExtractions")?.documents,
    ).toHaveLength(0);
  });

  it("sends only a non-stored JPEG data URL through the strict OpenAI format", async () => {
    let request: Record<string, unknown> | undefined;
    const provider = createOpenAIReceiptVisionProvider({ model: "gpt-test" }, {
      responses: {
        parse: async (input: Record<string, unknown>) => {
          request = input;
          return {
            status: "completed",
            output_parsed: validOutput,
            id: "resp_123",
            model: "gpt-test-2026-10-01",
          };
        },
      },
    } as never);

    await expect(provider.extract(image)).resolves.toMatchObject({
      output: validOutput,
      responseId: "resp_123",
      model: "gpt-test-2026-10-01",
    });
    expect(request).toMatchObject({ model: "gpt-test", store: false });
    const content = (
      request?.input as Array<{ content: Array<Record<string, unknown>> }>
    )[0]?.content;
    expect(content?.[1]).toMatchObject({
      type: "input_image",
      detail: "high",
      image_url: `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`,
    });
  });

  it("uses the Vercel AI Gateway OpenAI model identity when OIDC is available", () => {
    const provider = createOpenAIReceiptVisionProvider(
      {
        model: "gpt-5.6-luna",
        vercelOidcToken: "oidc-token-for-test-only",
      },
      { responses: {} } as never,
    );

    expect(provider.provider).toBe("vercel-ai-gateway/openai");
    expect(provider.model).toBe("openai/gpt-5.6-luna");
  });
});

function readyDatabase() {
  const database = new MemoryDatabase();
  const documents = new MemoryCollection();
  documents.documents.push({
    _id: sourceDocumentId,
    storeId,
    sourceType: "WASTE_RECEIPT",
    remoteUploadStatus: "CONFIRMED",
    normalizationStatus: "READY",
    normalizedObjectKey,
  });
  database.collections.set("sourceDocuments", documents);
  return database;
}

function providerReturning(
  output: () => Promise<unknown>,
): ReceiptVisionProvider {
  return {
    provider: "test-vision",
    model: "test-model",
    extract: async (bytes) => {
      expect(bytes).toEqual(image);
      return {
        output: await output(),
        responseId: "response-1",
        model: "test-model-2026-10-01",
      };
    },
  };
}

function matches(
  document: Record<string, unknown>,
  query: Record<string, unknown>,
) {
  return Object.entries(query).every(([key, value]) => document[key] === value);
}
