import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LocalFileMetadata,
  WasteLine,
  WasteReceipt,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { WasteReceiptRepository } from "./waste-receipt-repository";

type SQLiteValue = string | number | null;

class NodeDatabase implements OutboxDatabase, AtomicMutationDatabase {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const directories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-10-04T16:00:00.000Z";

function receipt(overrides: Partial<WasteReceipt> = {}): WasteReceipt {
  return {
    id: receiptId,
    storeId,
    sourceDocumentId: null,
    localFileId: fileId,
    captureDate: timestamp,
    detectedReceiptDate: null,
    confirmedWasteDate: null,
    processingStatus: "CAPTURED",
    aiStatus: "PENDING",
    duplicateStatus: "UNCHECKED",
    note: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncState: "LOCAL_ONLY",
    remoteVersion: null,
    dirty: true,
    ...overrides,
  };
}

function file(overrides: Partial<LocalFileMetadata> = {}): LocalFileMetadata {
  return {
    id: fileId,
    storeId,
    sourceDocumentId: null,
    localUri: "file:///documents/waste-receipts/ticket.heic",
    mimeType: "image/heic",
    sizeBytes: 4096,
    checksum: "sha256:receipt",
    retentionStatus: "RETAINED",
    uploadStatus: "LOCAL_ONLY",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function line(overrides: Partial<WasteLine> = {}): WasteLine {
  return {
    id: lineId,
    storeId,
    receiptId,
    sourceLineIndex: 0,
    rawLabel: "TOMATE VRAC",
    quantity: null,
    weight: "1.25",
    quantityUnit: "KG",
    unitPrice: "3.50",
    totalPrice: "4.38",
    matchedProductId: null,
    matchStatus: "UNMATCHED",
    matchConfidence: null,
    productNature: "UNKNOWN",
    extractionConfidence: { rawLabel: 0.98 },
    sourceRegion: { page: 1, x: 0.1, y: 0.2 },
    validationStatus: "TO_REVIEW",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncState: "LOCAL_ONLY",
    remoteVersion: null,
    dirty: true,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WasteReceiptRepository", () => {
  it("preserves the receipt, source file, and lines across a database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-receipts-"));
    directories.push(directory);
    const path = join(directory, "local.db");
    const firstDatabase = new DatabaseSync(path);
    const firstAdapter = new NodeDatabase(firstDatabase);
    await runLocalMigrations(firstAdapter);

    await new WasteReceiptRepository(firstAdapter).createDraft({
      receipt: receipt(),
      file: file(),
      lines: [line()],
    });
    firstDatabase.close();

    const reopenedDatabase = new DatabaseSync(path);
    const reopenedAdapter = new NodeDatabase(reopenedDatabase);
    await runLocalMigrations(reopenedAdapter);
    const repository = new WasteReceiptRepository(reopenedAdapter);

    await expect(repository.getReceipt(receiptId)).resolves.toMatchObject({
      id: receiptId,
      localFileId: fileId,
      processingStatus: "CAPTURED",
      aiStatus: "PENDING",
      syncState: "LOCAL_ONLY",
    });
    await expect(repository.listReceipts(storeId)).resolves.toMatchObject([
      {
        receipt: { id: receiptId },
        localFileUri: "file:///documents/waste-receipts/ticket.heic",
        lineCount: 1,
      },
    ]);
    await expect(repository.listLines(receiptId)).resolves.toMatchObject([
      {
        id: lineId,
        rawLabel: "TOMATE VRAC",
        weight: "1.25",
        extractionConfidence: { rawLabel: 0.98 },
      },
    ]);

    reopenedDatabase.close();
  });

  it("rolls back the whole draft when its lines cannot be inserted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-receipts-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new WasteReceiptRepository(adapter);

    await expect(
      repository.createDraft({
        receipt: receipt(),
        file: file(),
        lines: [line(), line({ id: "55555555-5555-4555-8555-555555555555" })],
      }),
    ).rejects.toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM waste_receipts").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM local_files").get(),
    ).toEqual({ count: 0 });

    database.close();
  });
});
