import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { documentNotificationDestination } from "./document-destination";
async function fixture(sourceType = "WEEKLY_COMMERCIAL_PDF") {
  const raw = new DatabaseSync(":memory:"),
    db = new ReceiptTestDatabase(raw),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    id = randomUUID(),
    receiptId = randomUUID();
  await runLocalMigrations(db);
  raw
    .prepare(
      "INSERT INTO source_documents(id,store_id,source_type,local_processing_status,remote_upload_status,version,created_at,updated_at) VALUES(?,?,?,'READY','CONFIRMED',1,?,?)",
    )
    .run(
      id,
      storeId,
      sourceType,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  if (sourceType === "WASTE_RECEIPT")
    raw
      .prepare(
        "INSERT INTO waste_receipts(id,store_id,source_document_id,processing_status,ai_status,duplicate_status,version,created_at,updated_at) VALUES(?,?,?,'TO_VALIDATE','READY','NONE',1,?,?)",
      )
      .run(
        receiptId,
        storeId,
        id,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  return {
    raw,
    db,
    id,
    receiptId,
    scope: { ownerId, storeId, role: "MANAGER" },
    data: {
      kind: "SOURCE_DOCUMENT_READY",
      resultKey: "a".repeat(64),
      ownerId,
      storeId,
      sourceDocumentId: id,
      sourceType,
    },
  };
}
it.each(["WEEKLY_COMMERCIAL_PDF", "WASTE_RECEIPT"])(
  "opens the conserved %s result using its actual local identity",
  async (kind) => {
    const f = await fixture(kind);
    try {
      expect(
        await documentNotificationDestination(f.db, f.scope, f.data),
      ).toEqual(
        kind === "WASTE_RECEIPT"
          ? { pathname: "/waste-receipt/[id]", params: { id: f.receiptId } }
          : {
              pathname: "/(tabs)/commercial-review/[id]",
              params: { id: f.id },
            },
      );
      expect(
        f.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.raw.close();
    }
  },
);
it.each(["owner", "store", "role", "type", "withdrawn", "missing"])(
  "refuses an unauthorized or stale %s destination",
  async (why) => {
    const f = await fixture();
    try {
      if (why === "owner") f.scope.ownerId = randomUUID();
      if (why === "store") f.scope.storeId = randomUUID();
      if (why === "role") f.scope.role = "STAFF";
      if (why === "type") f.data.sourceType = "WASTE_RECEIPT";
      if (why === "withdrawn")
        f.raw
          .prepare("UPDATE source_documents SET deleted_at=? WHERE id=?")
          .run(new Date().toISOString(), f.id);
      if (why === "missing") f.data.sourceDocumentId = randomUUID();
      expect(
        await documentNotificationDestination(f.db, f.scope, f.data),
      ).toBeUndefined();
    } finally {
      f.raw.close();
    }
  },
);
