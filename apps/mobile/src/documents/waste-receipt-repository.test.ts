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
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { matchProduct, normalizeProductLabel } from "@fl-copilot/domain";
import { WasteReceiptRepository } from "./waste-receipt-repository";
import { catalogueSnapshotIdentity } from "@fl-copilot/domain";
import {
  emptyProductDraft,
  loadProductEditorSnapshot,
  saveProductEditorLocally,
} from "../products/product-editor-service";
import {
  loadReceiptProductTarget,
  receiptProductOriginSchema,
  canSelectReceiptProduct,
} from "./receipt-product-selection";
import { randomUUID } from "node:crypto";

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

describe("explicit waste label memory", () => {
  async function setup() {
    const directory = mkdtempSync(join(tmpdir(), "fl-waste-alias-"));
    directories.push(directory);
    const path = join(directory, "local.db");
    const database = new DatabaseSync(path);
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const productId = "77777777-7777-4777-8777-777777777777";
    database
      .prepare(
        `INSERT INTO products (id, store_id, label, category, nature, sales_unit, status, version, created_at, updated_at, sync_state, dirty) VALUES (?, ?, 'TOMATE GRAPPE VRAC', 'VEGETABLE', 'BULK', 'KG', 'ACTIVE', 1, ?, ?, 'SYNCED', 0)`,
      )
      .run(productId, storeId, timestamp, timestamp);
    await new WasteReceiptRepository(adapter).createDraft({
      receipt: receipt(),
      file: file(),
      lines: [
        line({
          rawLabel: "TOM GRAP VRA",
          matchedProductId: productId,
          matchStatus: "MATCHED",
        }),
      ],
    });
    return {
      path,
      database,
      adapter,
      productId,
      repository: new ProductMasterRepository(adapter),
    };
  }
  const aliasId = "88888888-8888-4888-8888-888888888888";
  const context = {
    commandId: "99999999-9999-4999-8999-999999999999",
    deviceId: fileId,
  };
  it("persists offline memory and one command; repeat taps are idempotent, and removal disables future matching", async () => {
    const { path, database, repository, productId } = await setup();
    expect(await repository.listAliasesByStore(storeId)).toHaveLength(0);
    await repository.rememberWasteReceiptAlias(
      receiptId,
      lineId,
      aliasId,
      context,
    );
    await repository.rememberWasteReceiptAlias(receiptId, lineId, fileId, {
      ...context,
      commandId: receiptId,
    });
    expect(
      database
        .prepare(
          "SELECT * FROM sync_outbox WHERE entity_type = 'product_alias'",
        )
        .all(),
    ).toHaveLength(1);
    database.close();
    const reopened = new DatabaseSync(path);
    const restored = new ProductMasterRepository(new NodeDatabase(reopened));
    const aliases = await restored.listAliasesByStore(storeId);
    expect(aliases[0]?.entity).toMatchObject({
      id: aliasId,
      productId,
      source: "WASTE_RECEIPT",
      status: "VALIDATED",
      normalizedAlias: normalizeProductLabel("TOM GRAP VRA"),
    });
    const products = (await restored.listProducts(storeId)).map(
      ({ entity }) => entity,
    );
    expect(
      matchProduct(
        { storeId, label: "TOM GRAP VRA" },
        {
          products,
          identifiers: [],
          aliases: aliases.map(({ entity }) => entity),
        },
      ).state,
    ).toBe("AUTO_MATCH");
    await restored.delete("product_alias", aliasId, storeId, timestamp, {
      ...context,
      commandId: sourceDocumentId,
    });
    expect(await restored.listAliasesByStore(storeId)).toHaveLength(0);
    expect(
      matchProduct(
        { storeId, label: "TOM GRAP VRA" },
        { products, identifiers: [], aliases: [] },
      ).method,
    ).not.toBe("VALIDATED_ALIAS");
    reopened.close();
  });
  it("blocks conflicting and rejected labels without overwriting them", async () => {
    const { database, repository, productId } = await setup();
    await repository.upsertAlias(
      {
        id: aliasId,
        storeId,
        productId,
        alias: "TOM GRAP VRA",
        normalizedAlias: normalizeProductLabel("TOM GRAP VRA"),
        source: "USER",
        status: "REJECTED",
        confidence: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      context,
    );
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, fileId, context),
    ).rejects.toThrow("WASTE_ALIAS_CONFLICT");
    expect((await repository.getAlias(aliasId))?.entity.status).toBe(
      "REJECTED",
    );
    database
      .prepare(
        "UPDATE product_aliases SET status = 'VALIDATED', product_id = ?",
      )
      .run(fileId);
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, fileId, context),
    ).rejects.toThrow("WASTE_ALIAS_CONFLICT");
    database.close();
  });
  it("resumes only an unchanged waste-alias delete conflict with a new command, atomically", async () => {
    const { database, adapter, repository } = await setup();
    const remote = await repository.rememberWasteReceiptAlias(
      receiptId,
      lineId,
      aliasId,
      context,
    );
    await repository.delete("product_alias", aliasId, storeId, timestamp, {
      ...context,
      commandId: sourceDocumentId,
    });
    const outbox = new OutboxRepository(adapter);
    await outbox.markSyncing(context.commandId);
    await outbox.markAcknowledged(context.commandId);
    const command = (await outbox.getById(sourceDocumentId))!;
    await outbox.markSyncing(sourceDocumentId);
    await outbox.markConflict(sourceDocumentId, "SYNC_VERSION_CONFLICT");
    const conflicts = new ConflictRepository(adapter);
    const result = {
      commandId: sourceDocumentId,
      entityType: "product_alias",
      entityId: aliasId,
      status: "CONFLICT" as const,
      remoteVersion: 1,
      remoteEntity: remote,
    };
    await conflicts.recordPushConflict(command, result);
    database
      .prepare("UPDATE sync_conflicts SET remote_payload_json = ?")
      .run(JSON.stringify({ ...remote, productId: fileId }));
    await expect(
      repository.retryWasteAliasDeletion(sourceDocumentId, {
        ...context,
        commandId: receiptId,
      }),
    ).rejects.toThrow("WASTE_ALIAS_RESOLUTION_UNSAFE");
    database
      .prepare("UPDATE sync_conflicts SET remote_payload_json = ?")
      .run(JSON.stringify(remote));
    database.exec(
      "CREATE TRIGGER fail_repair BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'REPAIR_FAILED'); END",
    );
    await expect(
      repository.retryWasteAliasDeletion(sourceDocumentId, {
        ...context,
        commandId: receiptId,
      }),
    ).rejects.toThrow("REPAIR_FAILED");
    expect((await conflicts.getById(sourceDocumentId))?.status).toBe("OPEN");
    database.exec("DROP TRIGGER fail_repair");
    await repository.retryWasteAliasDeletion(sourceDocumentId, {
      ...context,
      commandId: receiptId,
    });
    expect(await outbox.getById(receiptId)).toMatchObject({
      status: "PENDING",
      expectedRemoteVersion: 1,
      payload: { version: 2 },
    });
    expect((await conflicts.getById(sourceDocumentId))?.status).toBe(
      "RESOLVED_LOCAL",
    );
    expect(
      (await outbox.listPending(storeId)).map((item) => item.commandId),
    ).toEqual([receiptId]);
    await expect(
      repository.retryWasteAliasDeletion(sourceDocumentId, {
        ...context,
        commandId: fileId,
      }),
    ).rejects.toThrow("WASTE_ALIAS_RESOLUTION_UNSAFE");
    database.close();
  });
  it("refuses canonical-label collisions and inactive products without changing the receipt", async () => {
    const { database, repository, productId } = await setup();
    database
      .prepare(
        `INSERT INTO products (id, store_id, label, category, nature, sales_unit, status, version, created_at, updated_at, sync_state, dirty) VALUES (?, ?, 'TOM GRAP VRA', 'VEGETABLE', 'BULK', 'KG', 'ACTIVE', 1, ?, ?, 'SYNCED', 0)`,
      )
      .run(fileId, storeId, timestamp, timestamp);
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, aliasId, context),
    ).rejects.toThrow("WASTE_ALIAS_CONFLICT");
    database
      .prepare("UPDATE products SET deleted_at = ? WHERE id = ?")
      .run(timestamp, fileId);
    database
      .prepare("UPDATE products SET status = 'INACTIVE' WHERE id = ?")
      .run(productId);
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, aliasId, context),
    ).rejects.toThrow("WASTE_ALIAS_PRODUCT_REQUIRED");
    expect(
      database
        .prepare(
          "SELECT matched_product_id, raw_label FROM waste_lines WHERE id = ?",
        )
        .get(lineId),
    ).toMatchObject({
      matched_product_id: productId,
      raw_label: "TOM GRAP VRA",
    });
    database.close();
  });
  it("rolls back alias when enqueue fails and refuses excluded or unresolved lines", async () => {
    const { database, repository } = await setup();
    database.exec(
      "CREATE TRIGGER fail_alias_command BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'OUTBOX_FAILURE'); END",
    );
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, aliasId, context),
    ).rejects.toThrow("OUTBOX_FAILURE");
    expect(await repository.listAliasesByStore(storeId)).toHaveLength(0);
    database.exec(
      "DROP TRIGGER fail_alias_command; UPDATE waste_lines SET validation_status = 'EXCLUDED'",
    );
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, aliasId, context),
    ).rejects.toThrow("WASTE_ALIAS_PRODUCT_REQUIRED");
    database.exec(
      "UPDATE waste_lines SET validation_status = 'PENDING', match_status = 'AMBIGUOUS'",
    );
    await expect(
      repository.rememberWasteReceiptAlias(receiptId, lineId, aliasId, context),
    ).rejects.toThrow("WASTE_ALIAS_PRODUCT_REQUIRED");
    database.close();
  });
});

describe("protected manual draft editing", () => {
  it("refuses stale line/header snapshots without changing values, then preserves an explicitly cleared cashier after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waste-review-"));
    directories.push(directory);
    const path = join(directory, "device.db");
    let database = new DatabaseSync(path);
    try {
      let adapter = new NodeDatabase(database);
      await runLocalMigrations(adapter);
      let repository = new WasteReceiptRepository(adapter);
      await repository.createDraft({
        receipt: receipt(),
        file: file(),
        lines: [line()],
      });
      const initial = (await repository.getReceiptDetail(receiptId, storeId))!;
      expect(
        await repository.getReceiptDetail(
          receiptId,
          "99999999-9999-4999-8999-999999999999",
        ),
      ).toBeNull();
      await repository.updateLineValues(
        receiptId,
        lineId,
        { rawLabel: "Corrigé", weight: "1.5", unitPrice: "2", totalPrice: "3" },
        initial.lines[0]!.line.version,
      );
      await expect(
        repository.updateLineValues(
          receiptId,
          lineId,
          {
            rawLabel: "Ancienne saisie",
            weight: "5",
            unitPrice: "2",
            totalPrice: "10",
          },
          initial.lines[0]!.line.version,
        ),
      ).rejects.toThrow("WASTE_RECEIPT_LINE_CHANGED");
      expect(
        (await repository.getReceiptDetail(receiptId))!.lines[0]!.line.rawLabel,
      ).toBe("Corrigé");
      await expect(
        repository.setLineExcluded(
          receiptId,
          lineId,
          true,
          initial.lines[0]!.line.version,
        ),
      ).rejects.toThrow("WASTE_RECEIPT_LINE_CHANGED");
      await expect(
        repository.selectProductCandidate(
          receiptId,
          lineId,
          "99999999-9999-4999-8999-999999999999",
          initial.lines[0]!.line.version,
        ),
      ).rejects.toThrow("WASTE_RECEIPT_LINE_CHANGED");

      await repository.confirmCashierNumber(
        receiptId,
        "000123",
        timestamp,
        initial.receipt.version,
      );
      await expect(
        repository.confirmWasteDate(
          receiptId,
          "2026-10-01",
          initial.receipt.version,
        ),
      ).rejects.toThrow("WASTE_RECEIPT_CHANGED");
      const latest = (await repository.getReceiptDetail(receiptId))!;
      await repository.confirmCashierNumber(
        receiptId,
        "",
        timestamp,
        latest.receipt.version,
      );
      database.close();
      database = new DatabaseSync(path);
      adapter = new NodeDatabase(database);
      repository = new WasteReceiptRepository(adapter);
      const restored = (await repository.getReceiptDetail(receiptId, storeId))!;
      expect(restored.receipt.confirmedCashierNumber).toBeNull();
      expect(restored.receipt.cashierNumberConfirmedAt).toBe(timestamp);
      expect(restored.lines[0]!.line.totalPrice).toBe("3");
      expect(
        await adapter.getFirstAsync("SELECT COUNT(*) AS n FROM sync_outbox"),
      ).toMatchObject({ n: 0 });
    } finally {
      database.close();
    }
  });
  it("checks editability on the transaction connection and refuses every correction once publication won the race", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      const adapter = new NodeDatabase(database);
      await runLocalMigrations(adapter);
      const repository = new WasteReceiptRepository(adapter);
      await repository.createDraft({
        receipt: receipt(),
        file: file(),
        lines: [line()],
      });
      // The UI has read the draft, but publication commits before its queued editor acquires the transaction.
      const original = adapter.withExclusiveTransactionAsync.bind(adapter);
      let intervened = false;
      adapter.withExclusiveTransactionAsync = async (task) => {
        if (!intervened) {
          intervened = true;
          database
            .prepare(
              "UPDATE waste_receipts SET processing_status='PUBLISHED',version=version+1 WHERE id=?",
            )
            .run(receiptId);
        }
        return original(task);
      };
      await expect(
        repository.updateLineValues(receiptId, lineId, {
          rawLabel: "Too late",
          weight: "1",
          unitPrice: "2",
          totalPrice: "2",
        }),
      ).rejects.toThrow("WASTE_RECEIPT_READ_ONLY");
      await expect(
        repository.confirmWasteDate(receiptId, "2026-10-01"),
      ).rejects.toThrow("WASTE_RECEIPT_READ_ONLY");
      await expect(
        repository.confirmCashierNumber(receiptId, "000999"),
      ).rejects.toThrow("WASTE_RECEIPT_READ_ONLY");
      await expect(
        repository.setLineExcluded(receiptId, lineId, true),
      ).rejects.toThrow("WASTE_RECEIPT_READ_ONLY");
      expect(
        (await repository.getReceiptDetail(receiptId))!.lines[0]!.line.rawLabel,
      ).toBe(line().rawLabel);
    } finally {
      database.close();
    }
  });
});

describe("explicit receipt catalogue selection", () => {
  async function fixture(path = ":memory:") {
    const db = new DatabaseSync(path),
      adapter = new NodeDatabase(db);
    await runLocalMigrations(adapter);
    const repo = new WasteReceiptRepository(adapter);
    await repo.createDraft({
      receipt: receipt(),
      file: file(),
      lines: [line()],
    });
    const productId = await saveProductEditorLocally(
      adapter,
      {
        ...emptyProductDraft,
        label: "Tomate nouvelle fiche",
        identifiers: [{ type: "ITM8", value: "00001234" }],
        aliases: [{ alias: "Tomate spéciale" }],
      },
      {
        storeId,
        deviceId: "99999999-9999-4999-8999-999999999999",
        now: () => timestamp,
        generateId: randomUUID,
      },
    );
    const snapshot = (await loadProductEditorSnapshot(
      new ProductMasterRepository(adapter),
      productId,
    ))!;
    const reviewed = { storeId, identity: catalogueSnapshotIdentity(snapshot) };
    return { db, adapter, repo, productId, snapshot, reviewed };
  }

  it("creates through the real product editor, associates an incomplete noncandidate locally without publishing/learning, and restores the choice after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "receipt-catalogue-"));
    directories.push(dir);
    const path = join(dir, "local.db");
    const { db, adapter, repo, productId, snapshot, reviewed } =
      await fixture(path);
    try {
      expect(snapshot.product.entity).toMatchObject({
        category: "UNKNOWN",
        nature: "UNKNOWN",
        salesUnit: "UNKNOWN",
      });
      expect(snapshot.identifiers[0]!.entity.value).toBe("00001234");
      expect(canSelectReceiptProduct({ record: snapshot.product })).toBe(true);
      const counts = () =>
        db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM sync_outbox) commands,(SELECT COUNT(*) FROM product_aliases) aliases",
          )
          .get();
      const before = counts();
      const target = await loadReceiptProductTarget(repo, storeId, {
        receiptId,
        lineId,
      });
      await repo.selectCatalogueProduct(
        receiptId,
        lineId,
        productId,
        target.draft.line.version,
        reviewed,
      );
      const saved = (await repo.getReceiptDetail(receiptId))!;
      expect(saved.receipt.processingStatus).toBe("CAPTURED");
      expect(saved.lines[0]!.line).toMatchObject({
        matchedProductId: productId,
        matchStatus: "MATCHED",
        productNature: "UNKNOWN",
        matchConfidence: null,
        rawLabel: "TOMATE VRAC",
        weight: "1.25",
        totalPrice: "4.38",
        version: 2,
        syncState: "LOCAL_ONLY",
      });
      expect(saved.lines[0]!.candidates).toEqual([]);
      expect(counts()).toEqual(before);
      expect(
        await adapter.getFirstAsync(
          "SELECT checksum FROM local_files WHERE id=?",
          fileId,
        ),
      ).toEqual({ checksum: "sha256:receipt" });
    } finally {
      db.close();
    }
    const reopened = new DatabaseSync(path);
    try {
      const restored = (await new WasteReceiptRepository(
        new NodeDatabase(reopened),
      ).getReceiptDetail(receiptId, storeId))!;
      expect(restored.lines[0]!.line.matchedProductId).toBe(productId);
      expect(restored.lines[0]!.line.version).toBe(2);
      expect(restored.receipt.processingStatus).toBe("CAPTURED");
    } finally {
      reopened.close();
    }
  });

  it.each([
    [
      "line revision",
      "UPDATE waste_lines SET version=version+1",
      "WASTE_RECEIPT_LINE_CHANGED",
    ],
    [
      "product label",
      "UPDATE products SET label='Changed',version=version+1",
      "WASTE_RECEIPT_PRODUCT_CHANGED",
    ],
    [
      "code without parent revision",
      "UPDATE product_identifiers SET value='00005678',version=version+1",
      "WASTE_RECEIPT_PRODUCT_CHANGED",
    ],
    [
      "alias without parent revision",
      "UPDATE product_aliases SET alias='Autre',normalized_alias='AUTRE',version=version+1",
      "WASTE_RECEIPT_PRODUCT_CHANGED",
    ],
    [
      "inactive product",
      "UPDATE products SET status='INACTIVE'",
      "WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID",
    ],
    [
      "deleted product",
      "UPDATE products SET deleted_at='2026-10-20T00:00:00.000Z'",
      "WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID",
    ],
    [
      "product sync failure",
      "UPDATE products SET sync_state='ERROR'",
      "WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID",
    ],
    [
      "other store",
      "UPDATE products SET store_id='99999999-9999-4999-8999-999999999999'",
      "WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID",
    ],
    [
      "published receipt",
      "UPDATE waste_receipts SET processing_status='PUBLISHED'",
      "WASTE_RECEIPT_READ_ONLY",
    ],
    [
      "deleted line",
      "UPDATE waste_lines SET deleted_at='2026-10-20T00:00:00.000Z'",
      "WASTE_RECEIPT_LINE_NOT_FOUND",
    ],
  ])("refuses %s atomically after a frozen review", async (_, sql, code) => {
    const { db, repo, productId, reviewed } = await fixture();
    try {
      db.exec(sql);
      const before = db.prepare("SELECT * FROM waste_lines").all();
      await expect(
        repo.selectCatalogueProduct(receiptId, lineId, productId, 1, reviewed),
      ).rejects.toThrow(code);
      expect(db.prepare("SELECT * FROM waste_lines").all()).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("rechecks related identity conflicts inside the write transaction and permits an ACK-only change", async () => {
    const { db, adapter, repo, productId, snapshot, reviewed } =
      await fixture();
    try {
      const conflicts = new ConflictRepository(adapter);
      const command = (
        await new OutboxRepository(adapter).listPending(storeId)
      ).find((c) => c.entityType === "product_identifier")!;
      await conflicts.recordPushConflict(command, {
        commandId: command.commandId,
        entityType: command.entityType,
        entityId: command.entityId,
        status: "CONFLICT",
        remoteVersion: 2,
        remoteEntity: snapshot.identifiers[0]!.entity,
      });
      await expect(
        repo.selectCatalogueProduct(receiptId, lineId, productId, 1, reviewed),
      ).rejects.toThrow("WASTE_RECEIPT_PRODUCT_CHANGED");
      db.exec(
        "DELETE FROM sync_conflicts; UPDATE products SET sync_state='SYNCED',remote_version=1,dirty=0; UPDATE product_identifiers SET sync_state='SYNCED',remote_version=1,dirty=0; UPDATE product_aliases SET sync_state='SYNCED',remote_version=1,dirty=0",
      );
      await repo.selectCatalogueProduct(
        receiptId,
        lineId,
        productId,
        1,
        reviewed,
      );
      expect((await repo.listLines(receiptId))[0]!.matchedProductId).toBe(
        productId,
      );
    } finally {
      db.close();
    }
  });

  it("rejects a foreign receipt/line and hostile navigation origin without changing any record", async () => {
    const { db, repo, reviewed, productId } = await fixture();
    try {
      expect(
        receiptProductOriginSchema.safeParse({
          receiptId,
          lineId,
          returnUrl: "https://evil.invalid",
        }).success,
      ).toBe(false);
      expect(
        receiptProductOriginSchema.safeParse({ receiptId: [receiptId], lineId })
          .success,
      ).toBe(false);
      await expect(
        loadReceiptProductTarget(repo, "99999999-9999-4999-8999-999999999999", {
          receiptId,
          lineId,
        }),
      ).rejects.toThrow("WASTE_RECEIPT_LINE_NOT_FOUND");
      await expect(
        loadReceiptProductTarget(repo, storeId, { receiptId, lineId: fileId }),
      ).rejects.toThrow("WASTE_RECEIPT_LINE_NOT_FOUND");
      await expect(
        repo.selectCatalogueProduct(receiptId, lineId, productId, 1, {
          ...reviewed,
          storeId: fileId,
        }),
      ).rejects.toThrow("WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID");
      expect((await repo.listLines(receiptId))[0]!.matchedProductId).toBeNull();
    } finally {
      db.close();
    }
  });
  it("rechecks the reviewed identity after acquiring the write transaction", async () => {
    const { db, adapter, repo, productId, reviewed } = await fixture();
    try {
      const acquire = adapter.withExclusiveTransactionAsync.bind(adapter);
      adapter.withExclusiveTransactionAsync = async (task) => {
        db.exec(
          "UPDATE product_identifiers SET value='00005678',version=version+1",
        );
        await acquire(task);
      };
      await expect(
        repo.selectCatalogueProduct(receiptId, lineId, productId, 1, reviewed),
      ).rejects.toThrow("WASTE_RECEIPT_PRODUCT_CHANGED");
      expect((await repo.listLines(receiptId))[0]!.matchedProductId).toBeNull();
    } finally {
      db.close();
    }
  });
});
