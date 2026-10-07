import { ApiClientError } from "@fl-copilot/api-client";
import type {
  CompleteSourceUploadRequest,
  CompleteSourceUploadResponse,
  InitSourceUploadRequest,
  InitSourceUploadResponse,
  ImportVerificationResult,
  VerifyImportRequest,
} from "@fl-copilot/sync-contracts";
import {
  fingerprintMercalysRecords,
  type ParsedMercalysArticleRecord,
} from "@fl-copilot/import-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { SourceDocumentRepository } from "./source-document-repository";
import { WasteReceiptRepository } from "./waste-receipt-repository";

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
  verify(
    storeId: string,
    sourceDocumentId: string,
    input: VerifyImportRequest,
  ): Promise<ImportVerificationResult>;
}

export interface SourceBinaryUploader {
  upload(input: {
    localUri: string;
    sourceType: InitSourceUploadRequest["sourceType"];
    uploadUrl: string;
    headers: Record<string, string>;
  }): Promise<{ localUri: string } | void>;
}

export class SourceUploadLocalFileMissingError extends Error {
  constructor() {
    super("SOURCE_UPLOAD_LOCAL_FILE_MISSING");
    this.name = "SourceUploadLocalFileMissingError";
  }
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
  business_period_start: string | null;
  business_period_end: string | null;
};

const activeUploadCycles = new WeakMap<
  UploadQueueDatabase,
  Map<string, Promise<{ attempted: number; confirmed: number }>>
>();

export class SourceUploadQueue {
  constructor(
    private readonly database: UploadQueueDatabase,
    private readonly transport: SourceUploadTransport,
    private readonly uploader: SourceBinaryUploader = nativeBinaryUploader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  process(storeId: string) {
    let cycles = activeUploadCycles.get(this.database);
    if (!cycles) {
      cycles = new Map();
      activeUploadCycles.set(this.database, cycles);
    }
    const active = cycles.get(storeId);
    if (active) return active;
    const run = this.processPending(storeId).finally(() => {
      if (cycles.get(storeId) === run) cycles.delete(storeId);
    });
    cycles.set(storeId, run);
    return run;
  }

  private async processPending(storeId: string) {
    await new SourceDocumentRepository(
      this.database,
    ).ensureCommercialPdfUploads(storeId);
    // No cycle is running for this database/store. Recover a claim left by app termination.
    await this.database.runAsync(
      `UPDATE local_jobs SET status = 'RETRY', next_attempt_at = NULL, last_error = 'SOURCE_UPLOAD_INTERRUPTED', updated_at = ? WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND status = 'RUNNING' AND json_extract(payload_json, '$.storeId') = ?`,
      this.now().toISOString(),
      storeId,
    );
    const rows = await this.database.getAllAsync<PendingUploadRow>(
      `
        SELECT j.id AS job_id, j.payload_json, j.attempt_count,
               d.source_type, d.original_filename, d.checksum,
               d.business_period_start, d.business_period_end,
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
        const uploadedFile = await this.uploader.upload({
          localUri: row.local_uri,
          sourceType: row.source_type,
          uploadUrl: init.uploadUrl,
          headers: init.headers,
        });
        if (uploadedFile && uploadedFile.localUri !== row.local_uri) {
          await this.updateLocalFileUri(
            payload,
            storeId,
            uploadedFile.localUri,
          );
        }
      }
      if (row.source_type === "WASTE_RECEIPT") {
        await this.database.runAsync(
          `UPDATE waste_receipts SET processing_status = 'EXTRACTING', ai_status = 'PROCESSING', updated_at = ? WHERE source_document_id = ? AND store_id = ? AND processing_status != 'PUBLISHED'`,
          this.now().toISOString(),
          payload.sourceDocumentId,
          storeId,
        );
      }
      const result = await this.transport.complete(storeId, init.uploadId, {
        checksum: row.checksum,
        sizeBytes: row.size_bytes,
      });
      if (result.remoteUploadStatus !== "CONFIRMED") {
        await this.markInvalid(row.job_id, payload, storeId);
        return false;
      }
      if (!isMercalysImport(row.source_type)) {
        const draft = result.wasteReceiptDraft;
        if (row.source_type === "WASTE_RECEIPT" && draft) {
          await new WasteReceiptRepository(this.database).applyRemoteDraft(
            payload.sourceDocumentId,
            draft,
            this.now().toISOString(),
          );
        }
        if (
          row.source_type === "WASTE_RECEIPT" &&
          result.wasteReceiptDuplicate
        ) {
          await new WasteReceiptRepository(this.database).applyRemoteDuplicate(
            payload.sourceDocumentId,
            result.wasteReceiptDuplicate.candidateSourceDocumentId,
            this.now().toISOString(),
          );
        }
        await this.markSourceUploaded(
          row.job_id,
          payload,
          storeId,
          Boolean(draft),
          row.source_type === "WASTE_RECEIPT" && !draft,
        );
        return true;
      }
      const verificationInput = await this.verificationInput(
        row,
        row.source_type,
        payload.sourceDocumentId,
        storeId,
      );
      const verification = await this.transport.verify(
        storeId,
        payload.sourceDocumentId,
        verificationInput,
      );
      const completedAt = this.now().toISOString();
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        if (verification.status === "DIFFERENCE") {
          await transaction.runAsync(
            `INSERT INTO import_verification_conflicts (
               source_document_id, store_id, local_fingerprint,
               remote_fingerprint, difference_summary_json, status,
               detected_at, acknowledged_at
             ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, NULL)
             ON CONFLICT(source_document_id) DO UPDATE SET
               local_fingerprint = excluded.local_fingerprint,
               remote_fingerprint = excluded.remote_fingerprint,
               difference_summary_json = excluded.difference_summary_json,
               status = 'OPEN', detected_at = excluded.detected_at,
               acknowledged_at = NULL`,
            payload.sourceDocumentId,
            storeId,
            verification.localFingerprint ??
              verificationInput.localNormalizedFingerprint,
            verification.remoteFingerprint ?? null,
            verification.differenceSummary
              ? JSON.stringify(verification.differenceSummary)
              : null,
            completedAt,
          );
        } else if (verification.status === "MATCH") {
          await transaction.runAsync(
            `UPDATE import_verification_conflicts
             SET status = 'RESOLVED', acknowledged_at = ?
             WHERE source_document_id = ? AND store_id = ? AND status = 'OPEN'`,
            completedAt,
            payload.sourceDocumentId,
            storeId,
          );
        }
        await transaction.runAsync(
          `UPDATE source_documents
           SET remote_upload_status = 'CONFIRMED',
               remote_processing_status = ?, sync_state = ?,
               dirty = 0, updated_at = ?
           WHERE id = ? AND store_id = ?`,
          verification.status === "MATCH"
            ? "PUBLISHED"
            : verification.status === "DIFFERENCE"
              ? "RECONCILING"
              : "FAILED",
          verification.status === "MATCH"
            ? "SYNCED"
            : verification.status === "DIFFERENCE"
              ? "CONFLICT"
              : "ERROR",
          completedAt,
          payload.sourceDocumentId,
          storeId,
        );
        await transaction.runAsync(
          `UPDATE local_files
           SET upload_status = 'CONFIRMED',
               retention_status = ?, updated_at = ?
           WHERE id = ? AND store_id = ?`,
          verification.status === "MATCH" ? "CLEANUP_ELIGIBLE" : "RETAINED",
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
      if (error instanceof SourceUploadLocalFileMissingError) {
        await this.markLocalFileMissing(row.job_id, payload, storeId);
        return false;
      }
      if (
        error instanceof ApiClientError &&
        [
          "SOURCE_UPLOAD_METADATA_MISMATCH",
          "SOURCE_DOCUMENT_ALREADY_REGISTERED",
          "COMMERCIAL_DOCUMENT_JOB_IDENTITY_MISMATCH",
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

  private async updateLocalFileUri(
    payload: UploadJobPayload,
    storeId: string,
    localUri: string,
  ) {
    const timestamp = this.now().toISOString();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE source_documents
         SET local_file_uri = ?, updated_at = ?
         WHERE id = ? AND store_id = ?`,
        localUri,
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_files
         SET local_uri = ?, updated_at = ?
         WHERE id = ? AND store_id = ?`,
        localUri,
        timestamp,
        payload.localFileId,
        storeId,
      );
    });
  }

  private async verificationInput(
    row: PendingUploadRow,
    sourceType: VerifyImportRequest["sourceType"],
    sourceDocumentId: string,
    storeId: string,
  ): Promise<VerifyImportRequest> {
    if (!row.business_period_start || !row.business_period_end) {
      throw new Error("IMPORT_VERIFICATION_PERIOD_MISSING");
    }
    const records = await this.database.getAllAsync<{
      normalized_payload_json: string;
    }>(
      `SELECT normalized_payload_json
       FROM source_records
       WHERE store_id = ? AND source_document_id = ?
         AND normalized_payload_json IS NOT NULL AND deleted_at IS NULL
       ORDER BY source_index, id`,
      storeId,
      sourceDocumentId,
    );
    const normalized = records.map(({ normalized_payload_json }) => {
      const payload = JSON.parse(normalized_payload_json) as {
        match?: unknown;
      } & ParsedMercalysArticleRecord;
      const record = { ...payload };
      delete record.match;
      return record;
    });
    return {
      sourceType,
      checksum: row.checksum,
      businessPeriodStart: row.business_period_start,
      businessPeriodEnd: row.business_period_end,
      localNormalizedFingerprint: fingerprintMercalysRecords(normalized),
      localRecordCount: normalized.length,
    };
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
    const offline = error instanceof ApiClientError && error.status === 0;
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
      await transaction.runAsync(
        `UPDATE waste_receipts
         SET processing_status = ?, ai_status = ?, updated_at = ?
         WHERE source_document_id = ? AND store_id = ? AND processing_status != 'PUBLISHED'`,
        offline ? "UPLOAD_PENDING" : "FAILED",
        offline ? "PENDING" : "FAILED",
        attemptedAt.toISOString(),
        payload.sourceDocumentId,
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
      await transaction.runAsync(
        `UPDATE waste_receipts
         SET processing_status = 'FAILED', updated_at = ?
         WHERE source_document_id = ? AND store_id = ?`,
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
    });
  }

  private async markLocalFileMissing(
    jobId: string,
    payload: UploadJobPayload,
    storeId: string,
  ) {
    const timestamp = this.now().toISOString();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE local_jobs
         SET status = 'FAILED', next_attempt_at = NULL,
             last_error = 'SOURCE_UPLOAD_LOCAL_FILE_MISSING', updated_at = ?
         WHERE id = ?`,
        timestamp,
        jobId,
      );
      await transaction.runAsync(
        `UPDATE source_documents
         SET remote_upload_status = 'FAILED', sync_state = 'ERROR', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_files
         SET upload_status = 'FAILED', updated_at = ?
         WHERE id = ? AND store_id = ?`,
        timestamp,
        payload.localFileId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE waste_receipts
         SET processing_status = 'FAILED', updated_at = ?
         WHERE source_document_id = ? AND store_id = ?`,
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
    });
  }

  private async markSourceUploaded(
    jobId: string,
    payload: UploadJobPayload,
    storeId: string,
    draftReady: boolean,
    analysisPending: boolean,
  ) {
    const timestamp = this.now().toISOString();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE source_documents
         SET remote_upload_status = 'CONFIRMED',
             remote_processing_status = ?, sync_state = 'SYNCED',
             dirty = 0, updated_at = ?
         WHERE id = ? AND store_id = ?`,
        draftReady ? "TO_VALIDATE" : "UPLOADED",
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_files
         SET upload_status = 'CONFIRMED', retention_status = 'RETAINED',
             updated_at = ?
         WHERE id = ? AND store_id = ?`,
        timestamp,
        payload.localFileId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE waste_receipts
         SET processing_status = ?, ai_status = ?, updated_at = ?
         WHERE source_document_id = ? AND store_id = ?`,
        draftReady ? "TO_VALIDATE" : "UPLOADED",
        draftReady ? "COMPLETED" : "PENDING",
        timestamp,
        payload.sourceDocumentId,
        storeId,
      );
      await transaction.runAsync(
        `UPDATE local_jobs
         SET status = ?, next_attempt_at = ?,
             last_error = NULL, updated_at = ?
         WHERE id = ?`,
        analysisPending ? "RETRY" : "COMPLETED",
        analysisPending
          ? new Date(this.now().getTime() + 60_000).toISOString()
          : null,
        timestamp,
        jobId,
      );
    });
  }
}

const nativeBinaryUploader: SourceBinaryUploader = {
  async upload(input) {
    const { File, Paths } = await import("expo-file-system");
    let file = new File(input.localUri);
    if (!file.exists) {
      const filename = Paths.parse(input.localUri).base;
      file = new File(
        Paths.document,
        input.sourceType === "WASTE_RECEIPT"
          ? "waste-receipts"
          : input.sourceType === "WEEKLY_COMMERCIAL_PDF"
            ? "commercial-pdfs"
            : "mercalys-imports",
        filename,
      );
    }
    if (!file.exists) throw new SourceUploadLocalFileMissingError();

    const response = await file.upload(input.uploadUrl, {
      httpMethod: "PUT",
      headers: input.headers,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`SOURCE_BLOB_HTTP_${response.status}`);
    }
    return { localUri: file.uri };
  },
};

function isMercalysImport(
  sourceType: InitSourceUploadRequest["sourceType"],
): sourceType is VerifyImportRequest["sourceType"] {
  return sourceType === "MERCALYS_SALES" || sourceType === "MERCALYS_WASTE";
}

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
