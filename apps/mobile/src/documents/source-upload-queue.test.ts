import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  SourceUploadQueue,
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("source upload queue", () => {
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
