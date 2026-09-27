import { describe, expect, it } from "vitest";
import {
  localFileMetadataSchema,
  localSourceDocumentSchema,
  sourceRecordSchema,
} from "./source-documents";

const timestamp = "2026-09-27T10:00:00.000Z";

describe("source document contracts", () => {
  it("preserves a checksum and JSON source lineage", () => {
    const document = localSourceDocumentSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      storeId: "22222222-2222-4222-8222-222222222222",
      sourceType: "MERCALYS_SALES",
      originalFilename: "ventes.xlsx",
      localFileUri: "file:///documents/ventes.xlsx",
      checksum: "sha256:abc123",
      sourceGeneratedAt: null,
      businessPeriodStart: "2026-09-26",
      businessPeriodEnd: "2026-09-27",
      localProcessingStatus: "PENDING",
      remoteUploadStatus: "LOCAL_ONLY",
      remoteProcessingStatus: null,
      parserVersion: null,
      extractionModelVersion: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      syncState: "LOCAL_ONLY",
      remoteVersion: null,
      dirty: true,
    });
    const record = sourceRecordSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      storeId: document.storeId,
      sourceDocumentId: document.id,
      sourceIndex: 0,
      sourcePage: null,
      rawPayload: { itm8: "00001234", sales: "12.30" },
      normalizedPayload: null,
      status: "RAW",
      errorCodes: [],
      warningCodes: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });

    expect(document.checksum).toBe("sha256:abc123");
    expect(record.rawPayload).toEqual({ itm8: "00001234", sales: "12.30" });
  });

  it("rejects an inverted business period", () => {
    expect(() =>
      localSourceDocumentSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        storeId: "22222222-2222-4222-8222-222222222222",
        sourceType: "MERCALYS_WASTE",
        businessPeriodStart: "2026-09-28",
        businessPeriodEnd: "2026-09-27",
        localProcessingStatus: "PENDING",
        remoteUploadStatus: "LOCAL_ONLY",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        syncState: "LOCAL_ONLY",
        dirty: true,
      }),
    ).toThrow("Business period end");
  });

  it("requires durable local file metadata", () => {
    const file = localFileMetadataSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      storeId: "22222222-2222-4222-8222-222222222222",
      sourceDocumentId: "11111111-1111-4111-8111-111111111111",
      localUri: "file:///documents/ventes.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 2048,
      checksum: "sha256:abc123",
      retentionStatus: "RETAINED",
      uploadStatus: "LOCAL_ONLY",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(file).toMatchObject({ sizeBytes: 2048, checksum: "sha256:abc123" });
  });
});
