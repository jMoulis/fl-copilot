import { ApiClientError } from "@fl-copilot/api-client";
import type {
  CompleteSourceUploadRequest,
  CompleteSourceUploadResponse,
  InitSourceUploadRequest,
  InitSourceUploadResponse,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";

type UploadQueueDatabase = OutboxDatabase & AtomicMutationDatabase;

export interface SourceUploadTransport {
  init(
    storeId: string,
    input: InitSourceUploadRequest,
  ): Promise<InitSourceUploadResponse>;
  complete(
    storeId: string,
    uploadId: string,
    input: CompleteSourceUploadRequest,
  ): Promise<CompleteSourceUploadResponse>;
}

export interface SourceBinaryUploader {
  upload(input: {
    localUri: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }): Promise<void>;
}

type UploadJobPayload = {
  storeId: string;
  sourceDocumentId: string;
  localFileId: string;
};

type PendingUploadRow = {
  job_id: string;
  payload_json: string;
  attempt_count: number;
  source_type: InitSourceUploadRequest["sourceType"];
  original_filename: string;
  checksum: string;
  local_uri: string;
  mime_type: InitSourceUploadRequest["mimeType"];
  size_bytes: number;
};

export class SourceUploadQueue {
  constructor(
    private readonly database: UploadQueueDatabase,
    private readonly transport: SourceUploadTransport,
    private readonly uploader: SourceBinaryUploader = nativeBinaryUploader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(storeId: string) {
    const rows = await this.database.getAllAsync<PendingUploadRow>(
      `
        SELECT j.id AS job_id, j.payload_json, j.attempt_count,
               d.source_type, d.original_filename, d.checksum,
               f.local_uri, f.mime_type, f.size_bytes
        FROM local_jobs j
        JOIN source_documents d
          ON d.id = json_extract(j.payload_json, '$.sourceDocumentId')
        JOIN local_files f
          ON f.id = json_extract(j.payload_json, '$.localFileId')
        WHERE j.type = 'SOURCE_UPLOAD_AND_REGISTER'
          AND j.status IN ('PENDING', 'RETRY')
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
          AND json_extract(j.payload_json, '$.storeId') = ?
        ORDER BY j.created_at, j.id
      `,
      this.now().toISOString(),
      storeId,
    );

    let confirmed = 0;
    for (const row of rows) {
      if (await this.processOne(storeId, row)) confirmed += 1;
    }
    return { attempted: rows.length, confirmed };
  }

  private async processOne(storeId: string, row: PendingUploadRow) {
    const payload = parseJobPayload(row.payload_json, storeId);
    const attemptedAt = this.now();
    await this.database.runAsync(
      `UPDATE local_jobs
       SET status = 'RUNNING', attempt_count = attempt_count + 1,
           last_error = NULL, updated_at = ?
       WHERE id = ?`,
      attemptedAt.toISOString(),
      row.job_id,
    );
    await this.database.runAsync(
      `UPDATE source_documents
       SET remote_upload_status = 'UPLOADING', updated_at = ?
       WHERE id = ? AND store_id = ?`,
      attemptedAt.toISOString(),
      payload.sourceDocumentId,
      storeId,
    );
    await this.database.runAsync(
      `UPDATE local_files
       SET upload_status = 'UPLOADING', updated_at = ?
       WHERE id = ? AND store_id = ?`,
      attemptedAt.toISOString(),
      payload.localFileId,
      storeId,
    );

    try {
      const init = await this.transport.init(storeId, {
        sourceDocumentId: payload.sourceDocumentId,
        sourceType: row.source_type,
        filename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        checksum: row.checksum,
      });
      if (init.status === "UPLOAD_REQUIRED") {
        if (!init.uploadUrl) throw new Error("SOURCE_UPLOAD_URL_MISSING");
        await this.uploader.upload({
          localUri: row.local_uri,
          uploadUrl: init.uploadUrl,
          headers: init.headers,
        });
      }
      const result = await this.transport.complete(storeId, init.uploadId, {
        checksum: row.checksum,
        sizeBytes: row.size_bytes,
      });
      if (result.remoteUploadStatus !== "CONFIRMED") {
        await this.markInvalid(row.job_id, payload, storeId);
        return false;
      }
      const completedAt = this.now().toISOString();
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `UPDATE source_documents
           SET remote_upload_status = 'CONFIRMED', sync_state = 'SYNCED',
               dirty = 0, updated_at = ?
           WHERE id = ? AND store_id = ?`,
          completedAt,
          payload.sourceDocumentId,
          storeId,
        );
        await transaction.runAsync(
          `UPDATE local_files
           SET upload_status = 'CONFIRMED',
               retention_status = 'CLEANUP_ELIGIBLE', updated_at = ?
           WHERE id = ? AND store_id = ?`,
          completedAt,
          payload.localFileId,
          storeId,
        );
        await transaction.runAsync(
          `UPDATE local_jobs
           SET status = 'COMPLETED', next_attempt_at = NULL,
               last_error = NULL, updated_at = ?
           WHERE id = ?`,
          completedAt,
          row.job_id,
        );
      });
      return true;
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        [
          "SOURCE_UPLOAD_METADATA_MISMATCH",
          "SOURCE_DOCUMENT_ALREADY_REGISTERED",
        ].includes(error.response.code)
      ) {
        await this.markInvalid(row.job_id, payload, storeId);
        return false;
      }
      await this.scheduleRetry(
        row.job_id,
        payload,
        storeId,
        row.attempt_count,
        error,
      );
      return false;
    }
  }

  private async scheduleRetry(
    jobId: string,
    payload: UploadJobPayload,
    storeId: string,
    previousAttempts: number,
    error: unknown,
  ) {
    const attemptedAt = this.now();
    const delayMs = Math.min(5 * 60_000, 2 ** previousAttempts * 5_000);
    const nextAttemptAt = new Date(
      attemptedAt.getTime() + delayMs,
    ).toISOString();
    const code =
      error instanceof ApiClientError
        ? error.response.code
        : error instanceof Error
          ? error.message.slice(0, 120)
          : "SOURCE_UPLOAD_FAILED";
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE local_jobs
         SET status = 'RETRY', next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
        nextAttemptAt,
        code,
        attemptedAt.toISOString(),
        jobId,
      );
      await transaction.runAsync(
        `UPDATE source_documents
         SET remote_upload_status = 'PENDING', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        attemptedAt.toISOString(),
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_files
         SET upload_status = 'PENDING', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        attemptedAt.toISOString(),
        payload.localFileId,
        storeId,
      );
    });
  }

  private async markInvalid(
    jobId: string,
    payload: UploadJobPayload,
    storeId: string,
  ) {
    const timestamp = this.now().toISOString();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE local_jobs
         SET status = 'FAILED', last_error = 'SOURCE_UPLOAD_INVALID', updated_at = ?
         WHERE id = ?`,
        timestamp,
        jobId,
      );
      await transaction.runAsync(
        `UPDATE source_documents
         SET remote_upload_status = 'INVALID', sync_state = 'ERROR', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_files
         SET upload_status = 'INVALID', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        timestamp,
        payload.localFileId,
        storeId,
      );
    });
  }
}

const nativeBinaryUploader: SourceBinaryUploader = {
  async upload(input) {
    const { File } = await import("expo-file-system");
    const response = await new File(input.localUri).upload(input.uploadUrl, {
      httpMethod: "PUT",
      headers: input.headers,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`SOURCE_BLOB_HTTP_${response.status}`);
    }
  },
};

function parseJobPayload(
  raw: string,
  expectedStoreId: string,
): UploadJobPayload {
  const value = JSON.parse(raw) as Partial<UploadJobPayload>;
  if (
    value.storeId !== expectedStoreId ||
    typeof value.sourceDocumentId !== "string" ||
    typeof value.localFileId !== "string"
  ) {
    throw new Error("SOURCE_UPLOAD_JOB_INVALID");
  }
  return value as UploadJobPayload;
}
