import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { COMMERCIAL_VISUAL_SCHEMA_VERSION } from "@fl-copilot/domain";
import { syncPullResponseSchema } from "@fl-copilot/sync-contracts";
import {
  serializeVisualReading,
  type VisualReadingDocument,
} from "../src/commercial/visual-reading-store";

function reading(analysisRevision?: number | null): VisualReadingDocument {
  const id = randomUUID();
  return {
    _id: id,
    id,
    storeId: randomUUID(),
    sourceDocumentId: randomUUID(),
    checksum: "synthetic-original-checksum",
    pageNumber: 1,
    pageCount: 1,
    analysisRevision,
    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    model: "controlled-test",
    remoteVersion: 1,
    status: "FAILED",
    errorCode: "COMMERCIAL_AI_FAILED",
    reading: null,
    createdAt: new Date("2026-11-04T12:00:00.000Z"),
    updatedAt: new Date("2026-11-04T12:00:00.000Z"),
  };
}

it.each([null, undefined, 1])(
  "keeps a reading JSON-safe in the complete sync envelope without changing its stored revision (%s)",
  (revision) => {
    const row = reading(revision);
    const entity = serializeVisualReading(row);
    const envelope = {
      changes: [
        {
          sequence: "1",
          entityType: "commercial_visual_reading",
          entityId: row.id,
          operation: "UPSERT",
          entityVersion: 1,
          entity,
          changedAt: row.updatedAt.toISOString(),
        },
      ],
      nextCursor: "controlled-cursor",
      hasMore: false,
      serverTime: row.updatedAt.toISOString(),
    };
    expect(() => syncPullResponseSchema.parse(envelope)).not.toThrow();
    expect(row.analysisRevision).toBe(revision);
    expect(row.status).toBe("FAILED");
    expect(entity.id).toBe(row.id);
    if (revision == null)
      expect(Object.hasOwn(entity, "analysisRevision")).toBe(false);
    else expect(entity.analysisRevision).toBe(revision);
    expect(entity.errorCode).toBe(row.errorCode);
  },
);
