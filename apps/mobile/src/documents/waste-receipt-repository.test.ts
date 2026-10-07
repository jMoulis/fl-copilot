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
const sourceDocumentId = "55555555-5555-4555-8555-555555555555";
const uploadJobId = "66666666-6666-4666-8666-666666666666";
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
  it("confirms cashier text with leading zeroes, survives restart, and permits an explicit empty value", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-cashier-"));
    directories.push(directory);
    const path = join(directory, "local.db");
    const database = new DatabaseSync(path);
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new WasteReceiptRepository(adapter);
    await repository.createDraft({
      receipt: receipt({ detectedCashierNumber: "000007" }),
      file: file(),
    });
    await repository.confirmCashierNumber(receiptId, " 000123 ", timestamp);
    expect(await repository.getReceipt(receiptId)).toMatchObject({
      detectedCashierNumber: "000007",
      confirmedCashierNumber: "000123",
      cashierNumberConfirmedAt: timestamp,
    });
    database.close();
    const reopened = new DatabaseSync(path);
    const repo = new WasteReceiptRepository(new NodeDatabase(reopened));
    expect(await repo.getReceipt(receiptId)).toMatchObject({
      confirmedCashierNumber: "000123",
    });
    await repo.confirmCashierNumber(receiptId, "", timestamp);
    expect(await repo.getReceipt(receiptId)).toMatchObject({
      detectedCashierNumber: "000007",
      confirmedCashierNumber: null,
      cashierNumberConfirmedAt: timestamp,
    });
    reopened.close();
  });

  it("atomically queues a captured receipt source for upload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-receipts-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);

    await new WasteReceiptRepository(adapter).createCapturedDraft({
      receiptId,
      fileId,
      sourceDocumentId,
      uploadJobId,
      storeId,
      capturedAt: timestamp,
      file: {
        originalFilename: "ticket.heic",
        localUri: "file:///documents/waste-receipts/ticket.heic",
        mimeType: "image/heic",
        sizeBytes: 4096,
        checksum: "sha256:receipt",
      },
    });

    expect(
      database
        .prepare(
          `SELECT source_document_id, processing_status, ai_status
           FROM waste_receipts WHERE id = ?`,
        )
        .get(receiptId),
    ).toEqual({
      source_document_id: sourceDocumentId,
      processing_status: "UPLOAD_PENDING",
      ai_status: "PENDING",
    });
    expect(
      database
        .prepare(
          `SELECT source_type, remote_upload_status, sync_state
           FROM source_documents WHERE id = ?`,
        )
        .get(sourceDocumentId),
    ).toEqual({
      source_type: "WASTE_RECEIPT",
      remote_upload_status: "PENDING",
      sync_state: "PENDING",
    });
    expect(
      database
        .prepare(`SELECT status, payload_json FROM local_jobs WHERE id = ?`)
        .get(uploadJobId),
    ).toEqual({
      status: "PENDING",
      payload_json: JSON.stringify({
        storeId,
        sourceDocumentId,
        localFileId: fileId,
      }),
    });
    database.close();
  });

  it("flags the same image locally and preserves both resolution choices", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-receipts-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new WasteReceiptRepository(adapter);
    const checksum = `sha256:${"a".repeat(64)}`;
    await repository.createCapturedDraft({
      receiptId,
      fileId,
      sourceDocumentId,
      uploadJobId,
      storeId,
      capturedAt: timestamp,
      file: {
        originalFilename: "original.jpg",
        localUri: "file:///documents/waste-receipts/original.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        checksum,
      },
    });

    const duplicateReceiptId = "77777777-7777-4777-8777-777777777777";
    const duplicateSourceId = "88888888-8888-4888-8888-888888888888";
    const duplicate = await repository.createCapturedDraft({
      receiptId: duplicateReceiptId,
      fileId: "99999999-9999-4999-8999-999999999999",
      sourceDocumentId: duplicateSourceId,
      uploadJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      storeId,
      capturedAt: "2026-10-04T16:05:00.000Z",
      file: {
        originalFilename: "copy.jpg",
        localUri: "file:///documents/waste-receipts/copy.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        checksum,
      },
    });

    expect(duplicate).toMatchObject({
      receipt: {
        duplicateStatus: "POSSIBLE_DUPLICATE",
        duplicateCandidateSourceDocumentId: sourceDocumentId,
        duplicateReason: "EXACT_IMAGE_CHECKSUM",
        processingStatus: "CAPTURED",
      },
      duplicateCandidate: {
        receiptId,
        sourceDocumentId,
      },
      uploadQueued: false,
    });
    await expect(
      repository.getReceiptDetail(duplicateReceiptId),
    ).resolves.toMatchObject({
      localFileUri: "file:///documents/waste-receipts/copy.jpg",
      duplicateCandidate: {
        localFileUri: "file:///documents/waste-receipts/original.jpg",
      },
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM local_jobs").get(),
    ).toEqual({ count: 1 });

    await repository.resolveExactDuplicate(
      duplicateReceiptId,
      "CONFIRM_DUPLICATE",
    );
    await expect(
      repository.getReceipt(duplicateReceiptId),
    ).resolves.toMatchObject({
      duplicateStatus: "CONFIRMED_DUPLICATE",
      processingStatus: "CAPTURED",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM local_files").get(),
    ).toEqual({ count: 2 });

    const keptReceiptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await repository.createCapturedDraft({
      receiptId: keptReceiptId,
      fileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      uploadJobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      storeId,
      capturedAt: "2026-10-04T16:10:00.000Z",
      file: {
        originalFilename: "legitimate-repeat.jpg",
        localUri: "file:///documents/waste-receipts/legitimate-repeat.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        checksum,
      },
    });
    const keptJobId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await repository.resolveExactDuplicate(
      keptReceiptId,
      "KEEP_BOTH",
      keptJobId,
    );
    await repository.applyRemoteDuplicate(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sourceDocumentId,
    );
    await expect(repository.getReceipt(keptReceiptId)).resolves.toMatchObject({
      duplicateStatus: "NOT_DUPLICATE",
      processingStatus: "UPLOAD_PENDING",
    });
    expect(
      database
        .prepare("SELECT status FROM local_jobs WHERE id = ?")
        .get(keptJobId),
    ).toEqual({ status: "PENDING" });

    database
      .prepare(
        `UPDATE source_documents SET remote_upload_status = 'CONFIRMED'
         WHERE id = ?`,
      )
      .run(sourceDocumentId);
    database
      .prepare(
        `UPDATE waste_receipts SET processing_status = 'TO_VALIDATE'
         WHERE id = ?`,
      )
      .run(receiptId);
    await repository.applyRemoteDuplicate(sourceDocumentId, duplicateSourceId);
    const jobCountBeforeRemoteResolution = database
      .prepare("SELECT COUNT(*) AS count FROM local_jobs")
      .get();
    await repository.resolveExactDuplicate(receiptId, "KEEP_BOTH");
    expect(
      database
        .prepare(
          `SELECT duplicate_status, processing_status
           FROM waste_receipts WHERE id = ?`,
        )
        .get(receiptId),
    ).toEqual({
      duplicate_status: "NOT_DUPLICATE",
      processing_status: "TO_VALIDATE",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM local_jobs").get(),
    ).toEqual(jobCountBeforeRemoteResolution);
    database.close();
  });

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

  it("hydrates a remote draft and keeps date, corrections, and product choice local", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-receipts-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new WasteReceiptRepository(adapter);
    await repository.createCapturedDraft({
      receiptId,
      fileId,
      sourceDocumentId,
      uploadJobId,
      storeId,
      capturedAt: timestamp,
      file: {
        originalFilename: "ticket.jpg",
        localUri: "file:///documents/waste-receipts/ticket.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        checksum: "sha256:receipt",
      },
    });
    await repository.confirmCashierNumber(receiptId, "000009", timestamp);
    const productId = "77777777-7777-4777-8777-777777777777";
    database
      .prepare(
        `INSERT INTO products (
           id, store_id, label, category, nature, sales_unit, status,
           version, created_at, updated_at, sync_state, dirty
         ) VALUES (?, ?, 'BANANE VRAC', 'FRUIT', 'BULK', 'KG', 'ACTIVE',
           1, ?, ?, 'SYNCED', 0)`,
      )
      .run(productId, storeId, timestamp, timestamp);

    await repository.applyRemoteDraft(
      sourceDocumentId,
      {
        detectedReceiptDate: "2026-10-03",
        detectedCashierNumber: "000003",
        extractionModelVersion: "gpt-test",
        arithmeticValidatorVersion: "waste-receipt.arithmetic.v1",
        productMatcherVersion: "product-matcher-v1",
        lines: [
          {
            lineId,
            sourceLineIndex: 0,
            rawLabel: "BANANE VRAC",
            quantity: null,
            weight: "0.58",
            quantityUnit: "KG",
            unitPrice: "4.99",
            totalPrice: "2.89",
            extractionConfidence: { label: 0.99 },
            sourceRegion: null,
            arithmeticStatus: "CONSISTENT",
            arithmeticExpectedTotal: "2.89",
            arithmeticDifference: "0.00",
            arithmeticWarningCode: null,
            matchState: "REVIEW",
            matchedProductId: null,
            matchedProductLabel: null,
            matchConfidence: 0.78,
            productNature: "UNKNOWN",
            candidates: [
              {
                productId,
                label: "BANANE VRAC",
                nature: "BULK",
                salesUnit: "KG",
                score: 0.78,
              },
            ],
            validationStatus: "TO_REVIEW",
          },
        ],
      },
      timestamp,
    );
    await repository.confirmWasteDate(receiptId, "2026-10-02");
    await expect(
      repository.confirmWasteDate(receiptId, "2026-99-99"),
    ).rejects.toThrow("WASTE_RECEIPT_DATE_INVALID");
    await repository.selectProductCandidate(receiptId, lineId, productId);
    await repository.updateLineValues(receiptId, lineId, {
      rawLabel: "Banane vrac corrigée",
      weight: "0.58",
      unitPrice: "4.99",
      totalPrice: "3.20",
    });

    await expect(repository.getReceiptDetail(receiptId)).resolves.toMatchObject(
      {
        receipt: {
          detectedReceiptDate: "2026-10-03",
          detectedCashierNumber: "000003",
          confirmedCashierNumber: "000009",
          confirmedWasteDate: "2026-10-02",
          processingStatus: "TO_VALIDATE",
          aiStatus: "COMPLETED",
        },
        lines: [
          {
            line: {
              rawLabel: "Banane vrac corrigée",
              matchedProductId: productId,
              matchStatus: "MATCHED",
              productNature: "BULK",
              validationStatus: "TO_REVIEW",
            },
            arithmeticStatus: "MISMATCH",
            arithmeticExpectedTotal: "2.89",
            arithmeticDifference: "0.31",
            matchedProductLabel: "BANANE VRAC",
          },
        ],
      },
    );
    database.close();
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
