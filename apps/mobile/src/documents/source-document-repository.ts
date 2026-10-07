import {
  localFileMetadataSchema,
  localSourceDocumentSchema,
  sourceRecordSchema,
  type LocalFileMetadata,
  type LocalSourceDocument,
  type SourceRecord,
  type SourceType,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

type SourceDocumentDatabase = AtomicMutationDatabase & OutboxDatabase;

export interface LocalSourceAggregate {
  document: LocalSourceDocument;
  file: LocalFileMetadata;
}

export class SourceDocumentRepository {
  constructor(private readonly database: SourceDocumentDatabase) {}

  async createWithFile(input: LocalSourceAggregate) {
    const document = localSourceDocumentSchema.parse(input.document);
    const file = localFileMetadataSchema.parse(input.file);
    assertAggregateConsistency(document, file);

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await insertDocument(transaction, document);
      await insertFile(transaction, file);
    });

    return { document, file };
  }

  async createCommercialPdf(input: LocalSourceAggregate) {
    const document = localSourceDocumentSchema.parse(input.document);
    const file = localFileMetadataSchema.parse(input.file);
    assertAggregateConsistency(document, file);
    if (
      document.sourceType !== "WEEKLY_COMMERCIAL_PDF" ||
      file.mimeType !== "application/pdf"
    )
      throw new Error("COMMERCIAL_PDF_REQUIRED");
    let result = { document, file, duplicate: false };
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await transaction.getFirstAsync<SourceDocumentRow>(
        `SELECT * FROM source_documents WHERE store_id = ? AND source_type = 'WEEKLY_COMMERCIAL_PDF' AND checksum = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
        document.storeId,
        document.checksum!,
      );
      if (existing) {
        const existingFile = await transaction.getFirstAsync<LocalFileRow>(
          "SELECT * FROM local_files WHERE source_document_id = ? ORDER BY created_at, id LIMIT 1",
          existing.id,
        );
        if (!existingFile)
          throw new Error("COMMERCIAL_PDF_FILE_METADATA_MISSING");
        result = {
          document: mapDocument(existing),
          file: mapFile(existingFile),
          duplicate: true,
        };
        return;
      }
      await insertDocument(transaction, document);
      await insertFile(transaction, file);
      await enqueueCommercialPdfUpload(
        transaction,
        document.id,
        document.storeId,
        file.id,
        document.createdAt,
      );
    });
    return result;
  }

  async ensureCommercialPdfUploads(storeId: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const rows = await transaction.getAllAsync<{
        id: string;
        file_id: string;
      }>(
        `SELECT d.id, f.id AS file_id FROM source_documents d JOIN local_files f ON f.source_document_id = d.id AND f.store_id = d.store_id
         WHERE d.store_id = ? AND d.source_type = 'WEEKLY_COMMERCIAL_PDF'
           AND d.deleted_at IS NULL AND d.remote_upload_status IN ('LOCAL_ONLY', 'PENDING', 'UPLOADING')
           AND NOT EXISTS (SELECT 1 FROM local_jobs j WHERE j.type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(j.payload_json, '$.sourceDocumentId') = d.id)`,
        storeId,
      );
      for (const row of rows)
        await enqueueCommercialPdfUpload(
          transaction,
          row.id,
          storeId,
          row.file_id,
          new Date().toISOString(),
        );
    });
  }

  async commercialPdfUploadJob(sourceDocumentId: string, storeId: string) {
    return this.database.getFirstAsync<{
      status: string;
      last_error: string | null;
    }>(
      "SELECT status, last_error FROM local_jobs WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json, '$.sourceDocumentId') = ? AND json_extract(payload_json, '$.storeId') = ? ORDER BY created_at, id LIMIT 1",
      sourceDocumentId,
      storeId,
    );
  }

  async retryCommercialPdfUpload(sourceDocumentId: string, storeId: string) {
    const result = await this.database.runAsync(
      `UPDATE local_jobs SET status = 'RETRY', next_attempt_at = NULL, updated_at = ?
       WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json, '$.sourceDocumentId') = ? AND json_extract(payload_json, '$.storeId') = ?
         AND status IN ('PENDING', 'RETRY') AND COALESCE(last_error, '') NOT IN ('SOURCE_UPLOAD_LOCAL_FILE_MISSING', 'SOURCE_UPLOAD_INVALID')
         AND EXISTS (SELECT 1 FROM source_documents d WHERE d.id = ? AND d.store_id = ? AND d.source_type = 'WEEKLY_COMMERCIAL_PDF' AND d.remote_upload_status != 'CONFIRMED')`,
      new Date().toISOString(),
      sourceDocumentId,
      storeId,
      sourceDocumentId,
      storeId,
    );
    return Number(result.changes) > 0;
  }

  async listDocuments(storeId: string, sourceType: SourceType) {
    const rows = await this.database.getAllAsync<SourceDocumentRow>(
      "SELECT * FROM source_documents WHERE store_id = ? AND source_type = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC",
      storeId,
      sourceType,
    );
    return rows.map(mapDocument);
  }

  async addRecords(recordsInput: readonly SourceRecord[]) {
    const records = recordsInput.map((record) =>
      sourceRecordSchema.parse(record),
    );
    if (records.length === 0) return [];

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const record of records) {
        const document = await transaction.getFirstAsync<{
          store_id: string;
        }>(
          "SELECT store_id FROM source_documents WHERE id = ?",
          record.sourceDocumentId,
        );
        if (!document || document.store_id !== record.storeId) {
          throw new Error(
            "Source record does not belong to its document store.",
          );
        }
        await insertRecord(transaction, record);
      }
    });

    return records;
  }

  async getDocument(id: string) {
    const row = await this.database.getFirstAsync<SourceDocumentRow>(
      "SELECT * FROM source_documents WHERE id = ?",
      id,
    );
    return row ? mapDocument(row) : null;
  }

  async getFileForDocument(sourceDocumentId: string) {
    const row = await this.database.getFirstAsync<LocalFileRow>(
      `
        SELECT * FROM local_files
        WHERE source_document_id = ?
        ORDER BY created_at, id
        LIMIT 1
      `,
      sourceDocumentId,
    );
    return row ? mapFile(row) : null;
  }

  async listRecords(sourceDocumentId: string) {
    const rows = await this.database.getAllAsync<SourceRecordRow>(
      `
        SELECT * FROM source_records
        WHERE source_document_id = ? AND deleted_at IS NULL
        ORDER BY source_index, source_page, id
      `,
      sourceDocumentId,
    );
    return rows.map(mapRecord);
  }

  async findDocumentByChecksum(
    storeId: string,
    sourceType: SourceType,
    checksum: string,
  ) {
    const row = await this.database.getFirstAsync<SourceDocumentRow>(
      `
        SELECT * FROM source_documents
        WHERE store_id = ? AND source_type = ? AND checksum = ?
          AND deleted_at IS NULL
        ORDER BY created_at, id
        LIMIT 1
      `,
      storeId,
      sourceType,
      checksum,
    );
    return row ? mapDocument(row) : null;
  }
}

function assertAggregateConsistency(
  document: LocalSourceDocument,
  file: LocalFileMetadata,
) {
  if (
    file.sourceDocumentId !== document.id ||
    file.storeId !== document.storeId
  ) {
    throw new Error("Local file does not belong to its source document.");
  }
  if (!document.checksum || document.checksum !== file.checksum) {
    throw new Error("Source document and local file checksums must match.");
  }
  if (document.localFileUri && document.localFileUri !== file.localUri) {
    throw new Error("Source document and local file URIs must match.");
  }
}

async function insertDocument(
  database: OutboxDatabase,
  document: LocalSourceDocument,
) {
  await database.runAsync(
    `
      INSERT INTO source_documents (
        id, store_id, source_type, original_filename, local_file_uri, checksum,
        source_generated_at, business_period_start, business_period_end,
        local_processing_status, remote_upload_status,
        remote_processing_status, parser_version, extraction_model_version,
        version, created_at, updated_at, deleted_at, sync_state,
        remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    document.id,
    document.storeId,
    document.sourceType,
    document.originalFilename ?? null,
    document.localFileUri ?? null,
    document.checksum ?? null,
    document.sourceGeneratedAt ?? null,
    document.businessPeriodStart ?? null,
    document.businessPeriodEnd ?? null,
    document.localProcessingStatus,
    document.remoteUploadStatus,
    document.remoteProcessingStatus ?? null,
    document.parserVersion ?? null,
    document.extractionModelVersion ?? null,
    document.version,
    document.createdAt,
    document.updatedAt,
    document.deletedAt ?? null,
    document.syncState,
    document.remoteVersion ?? null,
    document.dirty ? 1 : 0,
  );
}

async function insertFile(database: OutboxDatabase, file: LocalFileMetadata) {
  await database.runAsync(
    `
      INSERT INTO local_files (
        id, store_id, source_document_id, local_uri, mime_type, size_bytes,
        checksum, retention_status, upload_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    file.id,
    file.storeId,
    file.sourceDocumentId ?? null,
    file.localUri,
    file.mimeType,
    file.sizeBytes,
    file.checksum,
    file.retentionStatus,
    file.uploadStatus,
    file.createdAt,
    file.updatedAt,
  );
}

async function insertRecord(database: OutboxDatabase, record: SourceRecord) {
  await database.runAsync(
    `
      INSERT INTO source_records (
        id, store_id, source_document_id, source_index, source_page,
        raw_payload_json, normalized_payload_json, status, error_codes_json,
        warning_codes_json, version, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.id,
    record.storeId,
    record.sourceDocumentId,
    record.sourceIndex ?? null,
    record.sourcePage ?? null,
    JSON.stringify(record.rawPayload),
    record.normalizedPayload === undefined || record.normalizedPayload === null
      ? null
      : JSON.stringify(record.normalizedPayload),
    record.status,
    JSON.stringify(record.errorCodes),
    JSON.stringify(record.warningCodes),
    record.version,
    record.createdAt,
    record.updatedAt,
    record.deletedAt ?? null,
  );
}

function mapDocument(row: SourceDocumentRow) {
  return localSourceDocumentSchema.parse({
    id: row.id,
    storeId: row.store_id,
    sourceType: row.source_type,
    originalFilename: row.original_filename,
    localFileUri: row.local_file_uri,
    checksum: row.checksum,
    sourceGeneratedAt: row.source_generated_at,
    businessPeriodStart: row.business_period_start,
    businessPeriodEnd: row.business_period_end,
    localProcessingStatus: row.local_processing_status,
    remoteUploadStatus: row.remote_upload_status,
    remoteProcessingStatus: row.remote_processing_status,
    parserVersion: row.parser_version,
    extractionModelVersion: row.extraction_model_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    dirty: row.dirty === 1,
  });
}

function mapFile(row: LocalFileRow) {
  return localFileMetadataSchema.parse({
    id: row.id,
    storeId: row.store_id,
    sourceDocumentId: row.source_document_id,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    retentionStatus: row.retention_status,
    uploadStatus: row.upload_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapRecord(row: SourceRecordRow) {
  return sourceRecordSchema.parse({
    id: row.id,
    storeId: row.store_id,
    sourceDocumentId: row.source_document_id,
    sourceIndex: row.source_index,
    sourcePage: row.source_page,
    rawPayload: JSON.parse(row.raw_payload_json) as unknown,
    normalizedPayload: row.normalized_payload_json
      ? (JSON.parse(row.normalized_payload_json) as unknown)
      : null,
    status: row.status,
    errorCodes: JSON.parse(row.error_codes_json) as unknown,
    warningCodes: JSON.parse(row.warning_codes_json) as unknown,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

interface SourceDocumentRow {
  id: string;
  store_id: string;
  source_type: string;
  original_filename: string | null;
  local_file_uri: string | null;
  checksum: string | null;
  source_generated_at: string | null;
  business_period_start: string | null;
  business_period_end: string | null;
  local_processing_status: string;
  remote_upload_status: string;
  remote_processing_status: string | null;
  parser_version: string | null;
  extraction_model_version: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: string;
  remote_version: number | null;
  dirty: number;
}

interface LocalFileRow {
  id: string;
  store_id: string;
  source_document_id: string | null;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  retention_status: string;
  upload_status: string;
  created_at: string;
  updated_at: string;
}

interface SourceRecordRow {
  id: string;
  store_id: string;
  source_document_id: string;
  source_index: number | null;
  source_page: number | null;
  raw_payload_json: string;
  normalized_payload_json: string | null;
  status: string;
  error_codes_json: string;
  warning_codes_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function enqueueCommercialPdfUpload(
  database: OutboxDatabase,
  sourceDocumentId: string,
  storeId: string,
  localFileId: string,
  timestamp: string,
) {
  await database.runAsync(
    `INSERT INTO local_jobs (id, type, payload_json, status, attempt_count, created_at, updated_at)
    VALUES (?, 'SOURCE_UPLOAD_AND_REGISTER', ?, 'PENDING', 0, ?, ?)`,
    sourceDocumentId,
    JSON.stringify({ storeId, sourceDocumentId, localFileId }),
    timestamp,
    timestamp,
  );
  await database.runAsync(
    "UPDATE source_documents SET remote_upload_status = 'PENDING', sync_state = 'PENDING', dirty = 1 WHERE id = ? AND store_id = ?",
    sourceDocumentId,
    storeId,
  );
  await database.runAsync(
    "UPDATE local_files SET upload_status = 'PENDING' WHERE id = ? AND store_id = ?",
    localFileId,
    storeId,
  );
}
