import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SourceDocumentRepository } from "./source-document-repository";
import { commercialPdfUploadPresentation } from "./commercial-pdf-upload";
import { ApiClientError } from "@fl-copilot/api-client";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  SourceUploadQueue,
  SourceUploadLocalFileMissingError,
  type SourceBinaryUploader,
  type SourceUploadTransport,
} from "./source-upload-queue";

type SQLiteValue = string | number | null;

class NodeDatabase
  implements SQLiteMigrationDatabase, OutboxDatabase, AtomicMutationDatabase
{
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

const temporaryDirectories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const sourceDocumentId = "22222222-2222-4222-8222-222222222222";
const localFileId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const uploadId = "55555555-5555-4555-8555-555555555555";
const checksum = `sha256:${"a".repeat(64)}`;
const mimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-upload-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  const adapter = new NodeDatabase(database);
  await runLocalMigrations(adapter);
  const createdAt = "2026-10-03T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO source_documents (
        id, store_id, source_type, original_filename, local_file_uri, checksum,
        business_period_start, business_period_end,
        local_processing_status, remote_upload_status, version, created_at,
        updated_at, sync_state, dirty
      ) VALUES (?, ?, 'MERCALYS_SALES', 'ventes.xlsx', 'file:///ventes.xlsx', ?,
        '2026-09-26', '2026-09-26',
        'PUBLISHED', 'PENDING', 1, ?, ?, 'PENDING', 1)`,
    )
    .run(sourceDocumentId, storeId, checksum, createdAt, createdAt);
  database
    .prepare(
      `INSERT INTO local_files (
        id, store_id, source_document_id, local_uri, mime_type, size_bytes,
        checksum, retention_status, upload_status, created_at, updated_at
      ) VALUES (?, ?, ?, 'file:///ventes.xlsx', ?, 27700, ?, 'RETAINED',
        'PENDING', ?, ?)`,
    )
    .run(
      localFileId,
      storeId,
      sourceDocumentId,
      mimeType,
      checksum,
      createdAt,
      createdAt,
    );
  database
    .prepare(
      `INSERT INTO source_records (
        id, store_id, source_document_id, source_index, raw_payload_json,
        normalized_payload_json, status, error_codes_json, warning_codes_json,
        version, created_at, updated_at
      ) VALUES ('66666666-6666-4666-8666-666666666666', ?, ?, 4, '{}', ?,
        'PUBLISHED', '[]', '[]', 1, ?, ?)`,
    )
    .run(
      storeId,
      sourceDocumentId,
      JSON.stringify({
        sourceIndex: 4,
        itm8: "00001234",
        ean: null,
        rawLabel: "POIRE CONFERENCE VRAC",
        businessDate: "2026-09-26",
        quantity: 1.82,
        purchaseValue: null,
        rceValue: null,
        salesValue: null,
        vatValue: null,
        marginValue: null,
        marginRate: null,
        rawValues: {},
        match: { state: "AUTO_MATCH" },
      }),
      createdAt,
      createdAt,
    );
  database
    .prepare(
      `INSERT INTO local_jobs (
        id, type, payload_json, status, attempt_count, created_at, updated_at
      ) VALUES (?, 'SOURCE_UPLOAD_AND_REGISTER', ?, 'PENDING', 0, ?, ?)`,
    )
    .run(
      jobId,
      JSON.stringify({ storeId, sourceDocumentId, localFileId }),
      createdAt,
      createdAt,
    );
  return { adapter, database };
}

async function wasteReceiptFixture() {
  const result = await fixture();
  result.database
    .prepare(
      `UPDATE source_documents
       SET source_type = 'WASTE_RECEIPT', original_filename = 'ticket.jpg',
           local_file_uri = 'file:///waste-receipts/ticket.jpg',
           business_period_start = NULL, business_period_end = NULL,
           local_processing_status = 'PENDING'
       WHERE id = ?`,
    )
    .run(sourceDocumentId);
  result.database
    .prepare(
      `UPDATE local_files
       SET local_uri = 'file:///waste-receipts/ticket.jpg',
           mime_type = 'image/jpeg'
       WHERE id = ?`,
    )
    .run(localFileId);
  result.database
    .prepare(
      `INSERT INTO waste_receipts (
        id, store_id, source_document_id, local_file_id, capture_date,
        processing_status, ai_status, duplicate_status, version, created_at,
        updated_at, sync_state, dirty
       ) VALUES ('77777777-7777-4777-8777-777777777777', ?, ?, ?, ?,
         'UPLOAD_PENDING', 'PENDING', 'UNCHECKED', 1, ?, ?, 'LOCAL_ONLY', 1)`,
    )
    .run(
      storeId,
      sourceDocumentId,
      localFileId,
      "2026-10-03T12:00:00.000Z",
      "2026-10-03T12:00:00.000Z",
      "2026-10-03T12:00:00.000Z",
    );
  return result;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("source upload queue", () => {
  it("persists an extraction failure, retains edits and retries the same source immediately on request", async () => {
    const { adapter, database } = await wasteReceiptFixture();
    const { WasteReceiptRepository } =
      await import("./waste-receipt-repository");
    const repository = new WasteReceiptRepository(adapter);
    const receiptId = "77777777-7777-4777-8777-777777777777";
    await repository.confirmWasteDate(receiptId, "2026-10-02");
    let calls = 0;
    const transport: SourceUploadTransport = {
      init: async () => ({
        uploadId,
        objectKey: "source",
        status: "ALREADY_UPLOADED",
        uploadUrl: null,
        expiresAt: null,
        headers: {},
      }),
      complete: async () => {
        calls++;
        expect((await repository.getReceipt(receiptId))?.aiStatus).toBe(
          "PROCESSING",
        );
        if (calls === 1)
          throw new ApiClientError(503, {
            code: "INTERNAL_ERROR",
            messageFr: "Analyse indisponible",
            retryable: true,
          });
        return {
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
          wasteReceiptDraft: {
            detectedReceiptDate: "2026-10-01",
            extractionModelVersion: "test",
            arithmeticValidatorVersion: "test",
            productMatcherVersion: "test",
            lines: [],
          },
        };
      },
      verify: async () => {
        throw new Error("No Mercalys verification");
      },
    };
    const queue = new SourceUploadQueue(
      adapter,
      transport,
      {
        upload: async () => {
          throw new Error("Must not upload again");
        },
      },
      () => new Date("2026-10-03T12:00:00.000Z"),
    );
    await queue.process(storeId);
    const failed = await repository.getReceiptDetail(receiptId);
    expect(failed).toMatchObject({
      receipt: {
        aiStatus: "FAILED",
        processingStatus: "FAILED",
        confirmedWasteDate: "2026-10-02",
      },
      uploadJob: {
        status: "RETRY",
        lastError: "INTERNAL_ERROR",
        attemptCount: 1,
      },
    });
    expect(await queue.process(storeId)).toEqual({
      attempted: 0,
      confirmed: 0,
    });
    await repository.retryProcessing(receiptId);
    expect(await queue.process(storeId)).toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(
      (await repository.getReceiptDetail(receiptId))?.receipt,
    ).toMatchObject({
      aiStatus: "COMPLETED",
      processingStatus: "TO_VALIDATE",
      confirmedWasteDate: "2026-10-02",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM source_documents").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM local_jobs WHERE type = 'SOURCE_UPLOAD_AND_REGISTER'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT local_uri, retention_status FROM local_files")
        .get(),
    ).toEqual({
      local_uri: "file:///waste-receipts/ticket.jpg",
      retention_status: "RETAINED",
    });
    await expect(repository.retryProcessing(receiptId)).rejects.toThrow(
      "WASTE_RECEIPT_RETRY_UNAVAILABLE",
    );
    database.close();
  });

  it("recovers interrupted claims and coalesces concurrent queue instances", async () => {
    const { database } = await wasteReceiptFixture();
    database.exec("UPDATE local_jobs SET status = 'RUNNING'");
    const path = (
      database.prepare("PRAGMA database_list").get() as { file: string }
    ).file;
    database.close();
    const reopened = new DatabaseSync(path);
    const recoveredAdapter = new NodeDatabase(reopened);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let initCalls = 0;
    const transport: SourceUploadTransport = {
      init: async () => {
        initCalls++;
        await gate;
        return {
          uploadId,
          objectKey: "source",
          status: "ALREADY_UPLOADED",
          uploadUrl: null,
          expiresAt: null,
          headers: {},
        };
      },
      complete: async () => ({
        sourceDocumentId,
        remoteUploadStatus: "CONFIRMED",
        jobId: null,
      }),
      verify: async () => {
        throw new Error("Must not verify");
      },
    };
    const first = new SourceUploadQueue(recoveredAdapter, transport).process(
      storeId,
    );
    const second = new SourceUploadQueue(recoveredAdapter, transport).process(
      storeId,
    );
    expect(first).toBe(second);
    release();
    await first;
    expect(initCalls).toBe(1);
    expect(
      reopened.prepare("SELECT status, attempt_count FROM local_jobs").get(),
    ).toEqual({ status: "RETRY", attempt_count: 1 });
    reopened.close();
  });

  it.each(["SOURCE_UPLOAD_INVALID", "SOURCE_UPLOAD_LOCAL_FILE_MISSING"])(
    "does not offer endless retries for %s",
    async (code) => {
      const { adapter, database } = await wasteReceiptFixture();
      database
        .prepare("UPDATE local_jobs SET status = 'FAILED', last_error = ?")
        .run(code);
      const { WasteReceiptRepository } =
        await import("./waste-receipt-repository");
      await expect(
        new WasteReceiptRepository(adapter).retryProcessing(
          "77777777-7777-4777-8777-777777777777",
        ),
      ).rejects.toThrow("WASTE_RECEIPT_RETRY_UNAVAILABLE");
      expect(database.prepare("SELECT status FROM local_jobs").get()).toEqual({
        status: "FAILED",
      });
      database.close();
    },
  );

  it("resumes a waste receipt upload after reconnect without Mercalys verification", async () => {
    const { adapter, database } = await wasteReceiptFixture();
    let currentTime = new Date("2026-10-03T12:00:00.000Z");
    let initCalls = 0;
    let binaryUploads = 0;
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async (_storeId, input) => {
          initCalls += 1;
          expect(input.sourceType).toBe("WASTE_RECEIPT");
          if (initCalls === 1) {
            throw new ApiClientError(0, {
              code: "NETWORK_UNAVAILABLE",
              messageFr: "Réseau indisponible.",
              retryable: true,
            });
          }
          return {
            uploadId,
            objectKey: `sources/${storeId}/${sourceDocumentId}/ticket.jpg`,
            status: "UPLOAD_REQUIRED",
            uploadUrl: "https://blob.example.test/presigned",
            expiresAt: "2026-10-03T12:10:00.000Z",
            headers: { "content-type": "image/jpeg" },
          };
        },
        complete: async () => ({
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
          wasteReceiptDraft: {
            detectedReceiptDate: "2026-10-02",
            extractionModelVersion: "gpt-test",
            arithmeticValidatorVersion: "waste-receipt.arithmetic.v1",
            productMatcherVersion: "product-matcher-v1",
            lines: [
              {
                lineId: "88888888-8888-4888-8888-888888888888",
                sourceLineIndex: 0,
                rawLabel: "BANANE VRAC",
                quantity: null,
                weight: "1.2",
                quantityUnit: "KG",
                unitPrice: "1.99",
                totalPrice: "2.39",
                extractionConfidence: { label: 0.99 },
                sourceRegion: null,
                arithmeticStatus: "CONSISTENT",
                arithmeticExpectedTotal: "2.39",
                arithmeticDifference: "0.00",
                arithmeticWarningCode: null,
                matchState: "NO_MATCH",
                matchedProductId: null,
                matchedProductLabel: null,
                matchConfidence: null,
                productNature: "UNKNOWN",
                candidates: [],
                validationStatus: "TO_REVIEW",
              },
            ],
          },
          wasteReceiptDuplicate: {
            status: "POSSIBLE_DUPLICATE",
            reason: "EXACT_IMAGE_CHECKSUM",
            candidateSourceDocumentId: "99999999-9999-4999-8999-999999999999",
          },
        }),
        verify: async () => {
          throw new Error("waste receipt must not use Mercalys verification");
        },
      },
      {
        upload: async (input) => {
          expect(input.sourceType).toBe("WASTE_RECEIPT");
          binaryUploads += 1;
        },
      },
      () => currentTime,
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 0,
    });
    expect(
      database.prepare("SELECT status FROM local_jobs WHERE id = ?").get(jobId),
    ).toEqual({ status: "RETRY" });
    expect(
      database.prepare("SELECT processing_status FROM waste_receipts").get(),
    ).toEqual({ processing_status: "UPLOAD_PENDING" });

    currentTime = new Date("2026-10-03T12:00:06.000Z");
    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(binaryUploads).toBe(1);
    expect(
      database
        .prepare(
          "SELECT remote_upload_status, remote_processing_status, sync_state, dirty FROM source_documents WHERE id = ?",
        )
        .get(sourceDocumentId),
    ).toEqual({
      remote_upload_status: "CONFIRMED",
      remote_processing_status: "TO_VALIDATE",
      sync_state: "SYNCED",
      dirty: 0,
    });
    expect(
      database
        .prepare(
          "SELECT upload_status, retention_status FROM local_files WHERE id = ?",
        )
        .get(localFileId),
    ).toEqual({ upload_status: "CONFIRMED", retention_status: "RETAINED" });
    expect(
      database
        .prepare(
          `SELECT processing_status, ai_status, detected_receipt_date,
                  duplicate_status, duplicate_candidate_source_document_id
           FROM waste_receipts`,
        )
        .get(),
    ).toEqual({
      processing_status: "TO_VALIDATE",
      ai_status: "COMPLETED",
      detected_receipt_date: "2026-10-02",
      duplicate_status: "POSSIBLE_DUPLICATE",
      duplicate_candidate_source_document_id:
        "99999999-9999-4999-8999-999999999999",
    });
    expect(
      database
        .prepare(
          "SELECT raw_label, weight, match_status, arithmetic_status FROM waste_lines",
        )
        .get(),
    ).toEqual({
      raw_label: "BANANE VRAC",
      weight: "1.2",
      match_status: "UNMATCHED",
      arithmetic_status: "CONSISTENT",
    });
    database.close();
  });

  it("uploads the binary once when confirmation is retried after reconnect", async () => {
    const { adapter, database } = await fixture();
    let currentTime = new Date("2026-10-03T12:00:00.000Z");
    let initCalls = 0;
    let completeCalls = 0;
    let binaryUploads = 0;
    const transport: SourceUploadTransport = {
      init: async () => {
        initCalls += 1;
        return initCalls === 1
          ? {
              uploadId,
              objectKey: `sources/${storeId}/${sourceDocumentId}/ventes.xlsx`,
              status: "UPLOAD_REQUIRED",
              uploadUrl: "https://blob.example.test/presigned",
              expiresAt: "2026-10-03T12:10:00.000Z",
              headers: { "content-type": mimeType },
            }
          : {
              uploadId,
              objectKey: `sources/${storeId}/${sourceDocumentId}/ventes.xlsx`,
              status: "ALREADY_UPLOADED",
              uploadUrl: null,
              expiresAt: null,
              headers: {} as Record<string, string>,
            };
      },
      complete: async () => {
        completeCalls += 1;
        if (completeCalls === 1) {
          throw new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Réseau indisponible.",
            retryable: true,
          });
        }
        return {
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
        };
      },
      verify: async (_storeId, requestedSourceDocumentId, input) => ({
        sourceDocumentId: requestedSourceDocumentId,
        status: "MATCH",
        localFingerprint: input.localNormalizedFingerprint,
        remoteFingerprint: input.localNormalizedFingerprint,
      }),
    };
    const uploader: SourceBinaryUploader = {
      upload: async () => {
        binaryUploads += 1;
      },
    };
    const queue = new SourceUploadQueue(
      adapter,
      transport,
      uploader,
      () => currentTime,
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 0,
    });
    expect(binaryUploads).toBe(1);
    expect(
      database.prepare("SELECT status FROM local_jobs WHERE id = ?").get(jobId),
    ).toEqual({ status: "RETRY" });

    currentTime = new Date("2026-10-03T12:00:06.000Z");
    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(binaryUploads).toBe(1);
    expect(
      database
        .prepare("SELECT status, attempt_count FROM local_jobs WHERE id = ?")
        .get(jobId),
    ).toEqual({ status: "COMPLETED", attempt_count: 2 });
    expect(
      database
        .prepare(
          "SELECT remote_upload_status, remote_processing_status, sync_state, dirty FROM source_documents WHERE id = ?",
        )
        .get(sourceDocumentId),
    ).toEqual({
      remote_upload_status: "CONFIRMED",
      remote_processing_status: "PUBLISHED",
      sync_state: "SYNCED",
      dirty: 0,
    });
    expect(
      database
        .prepare(
          "SELECT upload_status, retention_status FROM local_files WHERE id = ?",
        )
        .get(localFileId),
    ).toEqual({
      upload_status: "CONFIRMED",
      retention_status: "CLEANUP_ELIGIBLE",
    });
    database.close();
  });

  it("keeps the local source pending while the authorization endpoint is offline", async () => {
    const { adapter, database } = await fixture();
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async () => {
          throw new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Réseau indisponible.",
            retryable: true,
          });
        },
        complete: async () => {
          throw new Error("must not complete");
        },
        verify: async () => {
          throw new Error("must not verify");
        },
      },
      {
        upload: async () => {
          throw new Error("must not upload");
        },
      },
      () => new Date("2026-10-03T12:00:00.000Z"),
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 0,
    });
    expect(
      database
        .prepare(
          "SELECT upload_status, retention_status FROM local_files WHERE id = ?",
        )
        .get(localFileId),
    ).toEqual({ upload_status: "PENDING", retention_status: "RETAINED" });
    database.close();
  });

  it("stops retrying without crashing when the local source file is gone", async () => {
    const { adapter, database } = await fixture();
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async () => ({
          uploadId,
          objectKey: `sources/${storeId}/${sourceDocumentId}/ventes.xlsx`,
          status: "UPLOAD_REQUIRED",
          uploadUrl: "https://blob.example.test/presigned",
          expiresAt: "2026-10-03T12:10:00.000Z",
          headers: { "content-type": mimeType },
        }),
        complete: async () => {
          throw new Error("must not complete");
        },
        verify: async () => {
          throw new Error("must not verify");
        },
      },
      {
        upload: async () => {
          throw new SourceUploadLocalFileMissingError();
        },
      },
      () => new Date("2026-10-03T12:05:00.000Z"),
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 0,
    });
    expect(
      database
        .prepare(
          "SELECT status, last_error, next_attempt_at FROM local_jobs WHERE id = ?",
        )
        .get(jobId),
    ).toEqual({
      status: "FAILED",
      last_error: "SOURCE_UPLOAD_LOCAL_FILE_MISSING",
      next_attempt_at: null,
    });
    expect(
      database
        .prepare(
          "SELECT remote_upload_status, sync_state FROM source_documents WHERE id = ?",
        )
        .get(sourceDocumentId),
    ).toEqual({ remote_upload_status: "FAILED", sync_state: "ERROR" });
    expect(
      database
        .prepare("SELECT upload_status FROM local_files WHERE id = ?")
        .get(localFileId),
    ).toEqual({ upload_status: "FAILED" });
    database.close();
  });

  it("persists a repaired URI when iOS moves the app data container", async () => {
    const { adapter, database } = await fixture();
    const repairedUri =
      "file:///current-container/mercalys-imports/ventes.xlsx";
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async () => ({
          uploadId,
          objectKey: `sources/${storeId}/${sourceDocumentId}/ventes.xlsx`,
          status: "UPLOAD_REQUIRED",
          uploadUrl: "https://blob.example.test/presigned",
          expiresAt: "2026-10-03T12:10:00.000Z",
          headers: { "content-type": mimeType },
        }),
        complete: async () => ({
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
        }),
        verify: async (_storeId, requestedSourceDocumentId, input) => ({
          sourceDocumentId: requestedSourceDocumentId,
          status: "MATCH",
          localFingerprint: input.localNormalizedFingerprint,
          remoteFingerprint: input.localNormalizedFingerprint,
        }),
      },
      { upload: async () => ({ localUri: repairedUri }) },
      () => new Date("2026-10-03T12:05:00.000Z"),
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(
      database
        .prepare("SELECT local_file_uri FROM source_documents WHERE id = ?")
        .get(sourceDocumentId),
    ).toEqual({ local_file_uri: repairedUri });
    expect(
      database
        .prepare("SELECT local_uri FROM local_files WHERE id = ?")
        .get(localFileId),
    ).toEqual({ local_uri: repairedUri });
    database.close();
  });

  it("persists a non-destructive conflict when remote verification differs", async () => {
    const { adapter, database } = await fixture();
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async () => ({
          uploadId,
          objectKey: `sources/${storeId}/${sourceDocumentId}/ventes.xlsx`,
          status: "ALREADY_UPLOADED",
          uploadUrl: null,
          expiresAt: null,
          headers: {} as Record<string, string>,
        }),
        complete: async () => ({
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
        }),
        verify: async (_storeId, requestedSourceDocumentId, input) => ({
          sourceDocumentId: requestedSourceDocumentId,
          status: "DIFFERENCE",
          localFingerprint: input.localNormalizedFingerprint,
          remoteFingerprint: `sha256:${"b".repeat(64)}`,
          differenceSummary: { added: 1, removed: 0, modified: 1 },
        }),
      },
      { upload: async () => undefined },
      () => new Date("2026-10-03T12:05:00.000Z"),
    );

    await expect(queue.process(storeId)).resolves.toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(
      database
        .prepare(
          "SELECT remote_processing_status, sync_state FROM source_documents WHERE id = ?",
        )
        .get(sourceDocumentId),
    ).toEqual({
      remote_processing_status: "RECONCILING",
      sync_state: "CONFLICT",
    });
    expect(
      database
        .prepare("SELECT retention_status FROM local_files WHERE id = ?")
        .get(localFileId),
    ).toEqual({ retention_status: "RETAINED" });
    expect(
      database
        .prepare(
          `SELECT remote_fingerprint, difference_summary_json, status
           FROM import_verification_conflicts
           WHERE source_document_id = ?`,
        )
        .get(sourceDocumentId),
    ).toEqual({
      remote_fingerprint: `sha256:${"b".repeat(64)}`,
      difference_summary_json: JSON.stringify({
        added: 1,
        removed: 0,
        modified: 1,
      }),
      status: "OPEN",
    });
    database.close();
  });
});

describe("commercial PDF upload queue", () => {
  async function pdfFixture() {
    const result = await fixture();
    result.database.exec(
      "UPDATE source_documents SET source_type = 'WEEKLY_COMMERCIAL_PDF', original_filename = 'week.pdf', business_period_start = NULL, business_period_end = NULL, local_processing_status = 'PENDING'; UPDATE local_files SET mime_type = 'application/pdf'",
    );
    return result;
  }
  it("recovers legacy PDFs into one stable job and confirms without Mercalys verification or deleting the original", async () => {
    const { adapter, database } = await pdfFixture();
    database.exec(
      "DELETE FROM local_jobs; UPDATE source_documents SET remote_upload_status = 'LOCAL_ONLY'",
    );
    const repository = new SourceDocumentRepository(adapter);
    await repository.ensureCommercialPdfUploads(storeId);
    await repository.ensureCommercialPdfUploads(storeId);
    expect(database.prepare("SELECT id, status FROM local_jobs").all()).toEqual(
      [{ id: sourceDocumentId, status: "PENDING" }],
    );
    let uploads = 0;
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async (_, input) => {
          expect(input).toMatchObject({
            sourceDocumentId,
            sourceType: "WEEKLY_COMMERCIAL_PDF",
            mimeType: "application/pdf",
            checksum,
          });
          return {
            uploadId,
            objectKey: "source",
            status: "UPLOAD_REQUIRED",
            uploadUrl: "https://blob.example/upload",
            expiresAt: null,
            headers: {},
          };
        },
        complete: async () => ({
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: sourceDocumentId,
        }),
        verify: async () => {
          throw new Error("PDF_MUST_NOT_VERIFY_MERCALYS");
        },
      },
      {
        upload: async (input) => {
          expect(input.sourceType).toBe("WEEKLY_COMMERCIAL_PDF");
          uploads++;
        },
      },
    );
    expect(await queue.process(storeId)).toEqual({
      attempted: 1,
      confirmed: 1,
    });
    expect(await queue.process(storeId)).toEqual({
      attempted: 0,
      confirmed: 0,
    });
    expect(uploads).toBe(1);
    const document = (await repository.getDocument(sourceDocumentId))!;
    expect(document).toMatchObject({
      remoteUploadStatus: "CONFIRMED",
      remoteProcessingStatus: "UPLOADED",
      businessPeriodStart: null,
      businessPeriodEnd: null,
    });
    expect(
      commercialPdfUploadPresentation(
        document,
        await repository.commercialPdfUploadJob(sourceDocumentId, storeId),
      ),
    ).toMatchObject({ title: "Document envoyé", canRetry: false });
    expect(
      database.prepare("SELECT retention_status FROM local_files").get(),
    ).toEqual({ retention_status: "RETAINED" });
    database.close();
  });
  it("retries the same source after losing completion, skips a second binary upload and clears backoff on explicit retry", async () => {
    const { adapter, database } = await pdfFixture();
    const repository = new SourceDocumentRepository(adapter);
    let binaryStored = false;
    let completes = 0;
    let uploads = 0;
    const sourceIds: string[] = [];
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async (_, input) => {
          sourceIds.push(input.sourceDocumentId);
          return {
            uploadId,
            objectKey: "source",
            status: binaryStored ? "ALREADY_UPLOADED" : "UPLOAD_REQUIRED",
            uploadUrl: binaryStored ? null : "https://blob.example/upload",
            expiresAt: null,
            headers: {},
          };
        },
        complete: async () => {
          if (++completes === 1)
            throw new ApiClientError(0, {
              code: "NETWORK_ERROR",
              messageFr: "Connexion indisponible",
              retryable: true,
            });
          return {
            sourceDocumentId,
            remoteUploadStatus: "CONFIRMED",
            jobId: sourceDocumentId,
          };
        },
        verify: async () => {
          throw new Error("Unexpected verification");
        },
      },
      {
        upload: async () => {
          uploads++;
          binaryStored = true;
        },
      },
      () => new Date("2026-10-07T08:00:00Z"),
    );
    expect(await queue.process(storeId)).toMatchObject({ confirmed: 0 });
    expect(await queue.process(storeId)).toMatchObject({ attempted: 0 });
    expect(
      await repository.retryCommercialPdfUpload(sourceDocumentId, storeId),
    ).toBe(true);
    expect(await queue.process(storeId)).toMatchObject({ confirmed: 1 });
    expect(sourceIds).toEqual([sourceDocumentId, sourceDocumentId]);
    expect(uploads).toBe(1);
    expect(
      database
        .prepare("SELECT id, attempt_count, status FROM local_jobs")
        .all(),
    ).toEqual([{ id: jobId, attempt_count: 2, status: "COMPLETED" }]);
    database.close();
  });
  it("keeps missing PDFs as non-retryable errors", async () => {
    const { adapter, database } = await pdfFixture();
    const repository = new SourceDocumentRepository(adapter);
    const queue = new SourceUploadQueue(
      adapter,
      {
        init: async () => ({
          uploadId,
          objectKey: "source",
          status: "UPLOAD_REQUIRED",
          uploadUrl: "https://blob.example/upload",
          expiresAt: null,
          headers: {},
        }),
        complete: async () => {
          throw new Error("Must not complete missing file");
        },
        verify: async () => {
          throw new Error("Must not verify");
        },
      },
      {
        upload: async () => {
          throw new SourceUploadLocalFileMissingError();
        },
      },
    );
    expect(await queue.process(storeId)).toMatchObject({ confirmed: 0 });
    expect(
      await repository.retryCommercialPdfUpload(sourceDocumentId, storeId),
    ).toBe(false);
    expect(
      commercialPdfUploadPresentation(
        (await repository.getDocument(sourceDocumentId))!,
        await repository.commercialPdfUploadJob(sourceDocumentId, storeId),
      ),
    ).toMatchObject({ title: "Fichier local indisponible", canRetry: false });
    expect(
      database.prepare("SELECT retention_status FROM local_files").get(),
    ).toEqual({ retention_status: "RETAINED" });
    database.close();
  });
});
