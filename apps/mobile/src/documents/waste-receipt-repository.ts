import {
  localFileMetadataSchema,
  localSourceDocumentSchema,
  wasteLineSchema,
  wasteReceiptSchema,
  type LocalFileMetadata,
  type LocalSourceDocument,
  type WasteLine,
  type WasteReceipt,
} from "@fl-copilot/domain";
import { validateWasteReceiptArithmetic } from "@fl-copilot/analytics-core";
import type {
  WasteReceiptDraft,
  WasteReceiptDraftCandidate,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

export interface LocalWasteReceiptAggregate {
  receipt: WasteReceipt;
  file: LocalFileMetadata;
  lines?: readonly WasteLine[];
}

export interface LocalWasteReceiptUploadJob {
  id: string;
  status: string;
  lastError: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
}

export interface LocalWasteReceiptSummary {
  receipt: WasteReceipt;
  localFileUri: string | null;
  lineCount: number;
  uploadJob: LocalWasteReceiptUploadJob | null;
}

export interface LocalWasteLineDraft {
  line: WasteLine;
  arithmeticStatus: "NOT_CHECKED" | "CONSISTENT" | "MISMATCH";
  arithmeticExpectedTotal: string | null;
  arithmeticDifference: string | null;
  arithmeticWarningCode: "AMOUNT_TO_REVIEW" | null;
  matchState: "AUTO_MATCH" | "REVIEW" | "AMBIGUOUS" | "NO_MATCH";
  matchedProductLabel: string | null;
  candidates: WasteReceiptDraftCandidate[];
}

export interface LocalWasteReceiptDetail {
  receipt: WasteReceipt;
  localFileUri: string | null;
  lines: LocalWasteLineDraft[];
  duplicateCandidate: LocalWasteDuplicateCandidate | null;
  uploadJob: LocalWasteReceiptUploadJob | null;
}

export interface LocalWasteDuplicateCandidate {
  receiptId: string;
  sourceDocumentId: string;
  captureDate: string | null;
  processingStatus: WasteReceipt["processingStatus"];
  localFileUri: string | null;
}

export interface CreateCapturedWasteReceiptResult extends LocalWasteReceiptAggregate {
  document: LocalSourceDocument;
  duplicateCandidate: LocalWasteDuplicateCandidate | null;
  uploadQueued: boolean;
}

export interface CreateCapturedWasteReceiptInput {
  receiptId: string;
  fileId: string;
  sourceDocumentId: string;
  uploadJobId: string;
  storeId: string;
  capturedAt: string;
  file: {
    originalFilename: string;
    localUri: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  };
}

export class WasteReceiptRepository {
  constructor(
    private readonly database: AtomicMutationDatabase & OutboxDatabase,
  ) {}

  async createCapturedDraft(input: CreateCapturedWasteReceiptInput) {
    const document = localSourceDocumentSchema.parse({
      id: input.sourceDocumentId,
      storeId: input.storeId,
      sourceType: "WASTE_RECEIPT",
      originalFilename: input.file.originalFilename,
      localFileUri: input.file.localUri,
      checksum: input.file.checksum,
      sourceGeneratedAt: input.capturedAt,
      businessPeriodStart: null,
      businessPeriodEnd: null,
      localProcessingStatus: "PENDING",
      remoteUploadStatus: "PENDING",
      remoteProcessingStatus: null,
      parserVersion: null,
      extractionModelVersion: null,
      version: 1,
      createdAt: input.capturedAt,
      updatedAt: input.capturedAt,
      deletedAt: null,
      syncState: "PENDING",
      remoteVersion: null,
      dirty: true,
    });
    const file = localFileMetadataSchema.parse({
      id: input.fileId,
      storeId: input.storeId,
      sourceDocumentId: input.sourceDocumentId,
      localUri: input.file.localUri,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.sizeBytes,
      checksum: input.file.checksum,
      retentionStatus: "RETAINED",
      uploadStatus: "PENDING",
      createdAt: input.capturedAt,
      updatedAt: input.capturedAt,
    });
    let result: CreateCapturedWasteReceiptResult | undefined;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const duplicateCandidate = await findExactReceiptDuplicate(
        transaction,
        input.storeId,
        input.file.checksum,
      );
      const receipt = wasteReceiptSchema.parse({
        id: input.receiptId,
        storeId: input.storeId,
        sourceDocumentId: input.sourceDocumentId,
        localFileId: input.fileId,
        captureDate: input.capturedAt,
        detectedReceiptDate: null,
        confirmedWasteDate: null,
        processingStatus: duplicateCandidate ? "CAPTURED" : "UPLOAD_PENDING",
        aiStatus: "PENDING",
        duplicateStatus: duplicateCandidate
          ? "POSSIBLE_DUPLICATE"
          : "NOT_DUPLICATE",
        duplicateCandidateSourceDocumentId:
          duplicateCandidate?.sourceDocumentId ?? null,
        duplicateReason: duplicateCandidate ? "EXACT_IMAGE_CHECKSUM" : null,
        note: null,
        version: 1,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
        deletedAt: null,
        syncState: "LOCAL_ONLY",
        remoteVersion: null,
        dirty: true,
      });
      assertAggregate(receipt, file, [], document);
      await insertSourceDocument(transaction, document);
      await insertLocalFile(transaction, file);
      await insertReceipt(transaction, receipt);
      if (!duplicateCandidate) {
        await insertUploadJob(
          transaction,
          input.uploadJobId,
          {
            storeId: input.storeId,
            sourceDocumentId: input.sourceDocumentId,
            localFileId: input.fileId,
          },
          input.capturedAt,
        );
      }
      result = {
        document,
        receipt,
        file,
        lines: [],
        duplicateCandidate,
        uploadQueued: !duplicateCandidate,
      };
    });
    if (!result) throw new Error("WASTE_RECEIPT_DRAFT_NOT_CREATED");
    return result;
  }

  async createDraft(input: LocalWasteReceiptAggregate) {
    const receipt = wasteReceiptSchema.parse(input.receipt);
    const file = localFileMetadataSchema.parse(input.file);
    const lines = (input.lines ?? []).map((line) =>
      wasteLineSchema.parse(line),
    );
    assertAggregate(receipt, file, lines);

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await insertLocalFile(transaction, file);
      await insertReceipt(transaction, receipt);
      for (const line of lines) await insertLine(transaction, line);
    });

    return { receipt, file, lines };
  }

  async getReceipt(id: string) {
    const row = await this.database.getFirstAsync<WasteReceiptRow>(
      "SELECT * FROM waste_receipts WHERE id = ?",
      id,
    );
    return row ? mapReceipt(row) : null;
  }

  async listReceipts(storeId: string): Promise<LocalWasteReceiptSummary[]> {
    const rows = await this.database.getAllAsync<WasteReceiptSummaryRow>(
      `
        SELECT r.*, f.local_uri,
          (
            SELECT COUNT(*)
            FROM waste_lines l
            WHERE l.receipt_id = r.id AND l.deleted_at IS NULL
          ) AS line_count
        FROM waste_receipts r
        LEFT JOIN local_files f ON f.id = r.local_file_id
        WHERE r.store_id = ? AND r.deleted_at IS NULL
        ORDER BY COALESCE(r.capture_date, r.created_at) DESC, r.id DESC
      `,
      storeId,
    );
    const jobs = await this.database.getAllAsync<UploadJobRow>(
      `SELECT id, status, last_error, next_attempt_at, attempt_count, json_extract(payload_json, '$.sourceDocumentId') AS source_document_id FROM local_jobs WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json, '$.storeId') = ? ORDER BY created_at`,
      storeId,
    );
    const bySource = new Map(
      jobs.map((job) => [job.source_document_id, mapUploadJob(job)]),
    );
    return rows.map((row) => ({
      receipt: mapReceipt(row),
      localFileUri: row.local_uri,
      lineCount: Number(row.line_count),
      uploadJob: bySource.get(row.source_document_id ?? "") ?? null,
    }));
  }

  async listLines(receiptId: string) {
    const rows = await this.database.getAllAsync<WasteLineRow>(
      `
        SELECT * FROM waste_lines
        WHERE receipt_id = ? AND deleted_at IS NULL
        ORDER BY source_line_index, id
      `,
      receiptId,
    );
    return rows.map(mapLine);
  }

  async getReceiptDetail(id: string): Promise<LocalWasteReceiptDetail | null> {
    const row = await this.database.getFirstAsync<
      WasteReceiptRow & { local_uri: string | null }
    >(
      `SELECT r.*, f.local_uri
       FROM waste_receipts r
       LEFT JOIN local_files f ON f.id = r.local_file_id
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      id,
    );
    if (!row) return null;
    const lines = await this.database.getAllAsync<WasteLineRow>(
      `SELECT * FROM waste_lines
       WHERE receipt_id = ? AND deleted_at IS NULL
       ORDER BY source_line_index, id`,
      id,
    );
    const duplicateCandidate = row.duplicate_candidate_source_document_id
      ? await findDuplicateCandidateBySourceDocument(
          this.database,
          row.duplicate_candidate_source_document_id,
        )
      : null;
    return {
      receipt: mapReceipt(row),
      localFileUri: row.local_uri,
      lines: lines.map(mapLineDraft),
      duplicateCandidate,
      uploadJob: await this.readUploadJob(row.store_id, row.source_document_id),
    };
  }

  private async readUploadJob(
    storeId: string,
    sourceDocumentId: string | null,
  ) {
    if (!sourceDocumentId) return null;
    const job = await this.database.getFirstAsync<UploadJobRow>(
      `SELECT id, status, last_error, next_attempt_at, attempt_count FROM local_jobs WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json, '$.storeId') = ? AND json_extract(payload_json, '$.sourceDocumentId') = ? ORDER BY created_at DESC LIMIT 1`,
      storeId,
      sourceDocumentId,
    );
    return job ? mapUploadJob(job) : null;
  }

  async retryProcessing(
    receiptId: string,
    timestamp = new Date().toISOString(),
  ) {
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      const receipt = await tx.getFirstAsync<WasteReceiptRow>(
        "SELECT * FROM waste_receipts WHERE id = ? AND deleted_at IS NULL",
        receiptId,
      );
      if (
        !receipt ||
        receipt.processing_status === "PUBLISHED" ||
        receipt.ai_status === "COMPLETED" ||
        ["POSSIBLE_DUPLICATE", "CONFIRMED_DUPLICATE"].includes(
          receipt.duplicate_status,
        )
      )
        throw new Error("WASTE_RECEIPT_RETRY_UNAVAILABLE");
      const job = await tx.getFirstAsync<UploadJobRow>(
        `SELECT id, status, last_error, next_attempt_at, attempt_count FROM local_jobs WHERE type = 'SOURCE_UPLOAD_AND_REGISTER' AND json_extract(payload_json, '$.storeId') = ? AND json_extract(payload_json, '$.sourceDocumentId') = ? ORDER BY created_at DESC LIMIT 1`,
        receipt.store_id,
        receipt.source_document_id,
      );
      if (
        !job ||
        job.status === "RUNNING" ||
        ["SOURCE_UPLOAD_INVALID", "SOURCE_UPLOAD_LOCAL_FILE_MISSING"].includes(
          job.last_error ?? "",
        )
      )
        throw new Error("WASTE_RECEIPT_RETRY_UNAVAILABLE");
      await tx.runAsync(
        "UPDATE local_jobs SET status = 'PENDING', next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
        timestamp,
        job.id,
      );
      await tx.runAsync(
        "UPDATE waste_receipts SET processing_status = 'UPLOAD_PENDING', ai_status = 'PENDING', updated_at = ? WHERE id = ?",
        timestamp,
        receiptId,
      );
    });
  }

  async resolveExactDuplicate(
    receiptId: string,
    resolution: "KEEP_BOTH" | "CONFIRM_DUPLICATE",
    uploadJobId?: string,
    timestamp = new Date().toISOString(),
  ) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const receipt = await transaction.getFirstAsync<{
        store_id: string;
        source_document_id: string | null;
        local_file_id: string | null;
        duplicate_status: string;
        remote_upload_status: string;
      }>(
        `SELECT r.store_id, r.source_document_id, r.local_file_id,
                r.duplicate_status, d.remote_upload_status
         FROM waste_receipts r
         JOIN source_documents d ON d.id = r.source_document_id
         WHERE r.id = ? AND r.deleted_at IS NULL`,
        receiptId,
      );
      if (
        !receipt ||
        receipt.duplicate_status !== "POSSIBLE_DUPLICATE" ||
        !receipt.source_document_id ||
        !receipt.local_file_id
      ) {
        throw new Error("WASTE_RECEIPT_DUPLICATE_NOT_REVIEWABLE");
      }
      if (resolution === "KEEP_BOTH") {
        const uploadAlreadyConfirmed =
          receipt.remote_upload_status === "CONFIRMED";
        if (!uploadAlreadyConfirmed) {
          if (!uploadJobId)
            throw new Error("WASTE_RECEIPT_UPLOAD_JOB_REQUIRED");
          await insertUploadJob(
            transaction,
            uploadJobId,
            {
              storeId: receipt.store_id,
              sourceDocumentId: receipt.source_document_id,
              localFileId: receipt.local_file_id,
            },
            timestamp,
          );
        }
        await transaction.runAsync(
          `UPDATE waste_receipts
           SET duplicate_status = 'NOT_DUPLICATE',
               processing_status = CASE WHEN ? = 1 THEN processing_status ELSE 'UPLOAD_PENDING' END,
               version = version + 1, updated_at = ?, dirty = 1,
               sync_state = 'LOCAL_ONLY'
           WHERE id = ?`,
          uploadAlreadyConfirmed ? 1 : 0,
          timestamp,
          receiptId,
        );
      } else {
        await transaction.runAsync(
          `UPDATE waste_receipts
           SET duplicate_status = 'CONFIRMED_DUPLICATE', processing_status = 'CAPTURED',
               version = version + 1, updated_at = ?, dirty = 1,
               sync_state = 'LOCAL_ONLY'
           WHERE id = ?`,
          timestamp,
          receiptId,
        );
        await transaction.runAsync(
          `UPDATE source_documents
           SET local_processing_status = 'COMPLETED', updated_at = ?,
               version = version + 1, dirty = 1, sync_state = 'LOCAL_ONLY'
           WHERE id = ? AND store_id = ?`,
          timestamp,
          receipt.source_document_id,
          receipt.store_id,
        );
      }
    });
  }

  async applyRemoteDuplicate(
    sourceDocumentId: string,
    candidateSourceDocumentId: string,
    timestamp = new Date().toISOString(),
  ) {
    await this.database.runAsync(
      `UPDATE waste_receipts
       SET duplicate_status = 'POSSIBLE_DUPLICATE',
           duplicate_candidate_source_document_id = ?,
           duplicate_reason = 'EXACT_IMAGE_CHECKSUM',
           version = version + 1, updated_at = ?, dirty = 1,
           sync_state = 'LOCAL_ONLY'
       WHERE source_document_id = ? AND deleted_at IS NULL
         AND (
           duplicate_status != 'NOT_DUPLICATE'
           OR duplicate_reason IS NULL
           OR duplicate_reason != 'EXACT_IMAGE_CHECKSUM'
         )`,
      candidateSourceDocumentId,
      timestamp,
      sourceDocumentId,
    );
  }

  async applyRemoteDraft(
    sourceDocumentId: string,
    draft: WasteReceiptDraft,
    timestamp = new Date().toISOString(),
  ) {
    const receipt = await this.database.getFirstAsync<{
      id: string;
      store_id: string;
    }>(
      `SELECT id, store_id FROM waste_receipts
       WHERE source_document_id = ? AND deleted_at IS NULL`,
      sourceDocumentId,
    );
    if (!receipt) throw new Error("WASTE_RECEIPT_LOCAL_DRAFT_NOT_FOUND");
    if ((await this.getReceipt(receipt.id))?.processingStatus === "PUBLISHED")
      return;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const line of draft.lines) {
        await transaction.runAsync(
          `INSERT INTO waste_lines (
             id, store_id, receipt_id, source_line_index, raw_label, quantity,
             weight, quantity_unit, unit_price, total_price, matched_product_id,
             match_status, match_confidence, product_nature,
             extraction_confidence_json, source_region_json, validation_status,
             version, created_at, updated_at, deleted_at, sync_state,
             remote_version, dirty, arithmetic_status,
             arithmetic_expected_total, arithmetic_difference,
             arithmetic_warning_code, match_state, matched_product_label,
             match_candidates_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, 'SYNCED', NULL, 0, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(receipt_id, source_line_index) DO UPDATE SET
             raw_label = excluded.raw_label,
             quantity = excluded.quantity,
             weight = excluded.weight,
             quantity_unit = excluded.quantity_unit,
             unit_price = excluded.unit_price,
             total_price = excluded.total_price,
             matched_product_id = excluded.matched_product_id,
             match_status = excluded.match_status,
             match_confidence = excluded.match_confidence,
             product_nature = excluded.product_nature,
             extraction_confidence_json = excluded.extraction_confidence_json,
             source_region_json = excluded.source_region_json,
             validation_status = excluded.validation_status,
             updated_at = excluded.updated_at,
             arithmetic_status = excluded.arithmetic_status,
             arithmetic_expected_total = excluded.arithmetic_expected_total,
             arithmetic_difference = excluded.arithmetic_difference,
             arithmetic_warning_code = excluded.arithmetic_warning_code,
             match_state = excluded.match_state,
             matched_product_label = excluded.matched_product_label,
             match_candidates_json = excluded.match_candidates_json
           WHERE waste_lines.dirty = 0`,
          line.lineId,
          receipt.store_id,
          receipt.id,
          line.sourceLineIndex,
          line.rawLabel,
          line.quantity,
          line.weight,
          line.quantityUnit,
          line.unitPrice,
          line.totalPrice,
          line.matchedProductId,
          localMatchStatus(line.matchState),
          line.matchConfidence,
          line.productNature,
          line.extractionConfidence === null
            ? null
            : JSON.stringify(line.extractionConfidence),
          line.sourceRegion === null ? null : JSON.stringify(line.sourceRegion),
          line.validationStatus,
          timestamp,
          timestamp,
          line.arithmeticStatus,
          line.arithmeticExpectedTotal,
          line.arithmeticDifference,
          line.arithmeticWarningCode,
          line.matchState,
          line.matchedProductLabel,
          JSON.stringify(line.candidates),
        );
      }
      await transaction.runAsync(
        `UPDATE waste_receipts
         SET detected_receipt_date = ?, processing_status = 'TO_VALIDATE',
             ai_status = 'COMPLETED', updated_at = ?, version = version + 1
         WHERE id = ? AND store_id = ?`,
        draft.detectedReceiptDate,
        timestamp,
        receipt.id,
        receipt.store_id,
      );
      await transaction.runAsync(
        `UPDATE source_documents
         SET remote_processing_status = 'TO_VALIDATE',
             extraction_model_version = ?, updated_at = ?
         WHERE id = ? AND store_id = ?`,
        draft.extractionModelVersion,
        timestamp,
        sourceDocumentId,
        receipt.store_id,
      );
    });
  }

  async confirmWasteDate(receiptId: string, date: string) {
    await this.assertEditable(receiptId);
    const parsedDate =
      wasteReceiptSchema.shape.confirmedWasteDate.safeParse(date);
    if (!parsedDate.success || parsedDate.data == null) {
      throw new Error("WASTE_RECEIPT_DATE_INVALID");
    }
    await this.database.runAsync(
      `UPDATE waste_receipts
       SET confirmed_waste_date = ?, updated_at = ?, version = version + 1,
           dirty = 1, sync_state = 'LOCAL_ONLY'
       WHERE id = ?`,
      parsedDate.data,
      new Date().toISOString(),
      receiptId,
    );
  }

  async updateLineValues(
    receiptId: string,
    lineId: string,
    input: {
      rawLabel: string;
      quantity?: string | null;
      quantityUnit?: WasteLine["quantityUnit"];
      weight: string | null;
      unitPrice: string | null;
      totalPrice: string | null;
    },
  ) {
    await this.assertEditable(receiptId);
    const current = await this.database.getFirstAsync<WasteLineRow>(
      `SELECT * FROM waste_lines WHERE id = ? AND receipt_id = ?`,
      lineId,
      receiptId,
    );
    if (!current) throw new Error("WASTE_RECEIPT_LINE_NOT_FOUND");
    const rawLabel = input.rawLabel.trim();
    if (!rawLabel) throw new Error("WASTE_RECEIPT_LABEL_REQUIRED");
    const arithmetic = validateWasteReceiptArithmetic([
      {
        sourceLineIndex: current.source_line_index,
        weight: nullableDecimal(input.weight),
        unitPrice: nullableDecimal(input.unitPrice),
        totalPrice: nullableDecimal(input.totalPrice),
      },
    ]).lines[0]!;
    const validationStatus =
      current.validation_status === "EXCLUDED"
        ? "EXCLUDED"
        : arithmetic.status === "MISMATCH" || current.match_status !== "MATCHED"
          ? "TO_REVIEW"
          : "PENDING";
    await this.database.runAsync(
      `UPDATE waste_lines
       SET raw_label = ?, quantity = ?, quantity_unit = ?, weight = ?, unit_price = ?, total_price = ?,
           arithmetic_status = ?, arithmetic_expected_total = ?,
           arithmetic_difference = ?, arithmetic_warning_code = ?,
           validation_status = ?, updated_at = ?, version = version + 1,
           dirty = 1, sync_state = 'LOCAL_ONLY'
       WHERE id = ? AND receipt_id = ?`,
      rawLabel,
      input.quantity === undefined
        ? current.quantity
        : nullableDecimal(input.quantity),
      input.quantityUnit === undefined
        ? current.quantity_unit
        : (input.quantityUnit ?? null),
      nullableDecimal(input.weight),
      nullableDecimal(input.unitPrice),
      nullableDecimal(input.totalPrice),
      arithmetic.status,
      arithmetic.expectedTotal,
      arithmetic.absoluteDifference,
      arithmetic.warningCode,
      validationStatus,
      new Date().toISOString(),
      lineId,
      receiptId,
    );
  }

  async setLineExcluded(receiptId: string, lineId: string, excluded: boolean) {
    await this.assertEditable(receiptId);
    await this.database.runAsync(
      "UPDATE waste_lines SET validation_status = ?, dirty = 1, sync_state = 'LOCAL_ONLY', version = version + 1, updated_at = ? WHERE id = ? AND receipt_id = ?",
      excluded ? "EXCLUDED" : "PENDING",
      new Date().toISOString(),
      lineId,
      receiptId,
    );
  }

  private async assertEditable(receiptId: string) {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt || receipt.processingStatus === "PUBLISHED")
      throw new Error("WASTE_RECEIPT_READ_ONLY");
  }

  async selectProductCandidate(
    receiptId: string,
    lineId: string,
    productId: string,
  ) {
    await this.assertEditable(receiptId);
    const row = await this.database.getFirstAsync<WasteLineRow>(
      `SELECT * FROM waste_lines WHERE id = ? AND receipt_id = ?`,
      lineId,
      receiptId,
    );
    if (!row) throw new Error("WASTE_RECEIPT_LINE_NOT_FOUND");
    const candidate = parseCandidates(row.match_candidates_json).find(
      (item) => item.productId === productId,
    );
    if (!candidate) throw new Error("WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID");
    await this.database.runAsync(
      `UPDATE waste_lines
       SET matched_product_id = ?, matched_product_label = ?,
           match_status = 'MATCHED', match_state = 'AUTO_MATCH',
           match_confidence = ?, product_nature = ?,
           validation_status = ?, updated_at = ?, version = version + 1,
           dirty = 1, sync_state = 'LOCAL_ONLY'
       WHERE id = ? AND receipt_id = ?`,
      candidate.productId,
      candidate.label,
      candidate.score,
      candidate.nature,
      row.validation_status === "EXCLUDED"
        ? "EXCLUDED"
        : row.arithmetic_status === "MISMATCH"
          ? "TO_REVIEW"
          : "PENDING",
      new Date().toISOString(),
      lineId,
      receiptId,
    );
  }
}

async function findExactReceiptDuplicate(
  database: OutboxDatabase,
  storeId: string,
  checksum: string,
): Promise<LocalWasteDuplicateCandidate | null> {
  const row = await database.getFirstAsync<DuplicateCandidateRow>(
    `SELECT r.id AS receipt_id, d.id AS source_document_id, r.capture_date,
            r.processing_status, f.local_uri
     FROM source_documents d
     JOIN waste_receipts r ON r.source_document_id = d.id
     LEFT JOIN local_files f ON f.id = r.local_file_id
     WHERE d.store_id = ? AND d.source_type = 'WASTE_RECEIPT'
       AND d.checksum = ?
       AND d.local_processing_status NOT IN ('FAILED', 'CANCELLED')
       AND d.deleted_at IS NULL AND r.deleted_at IS NULL
       AND r.duplicate_status != 'CONFIRMED_DUPLICATE'
     ORDER BY COALESCE(r.capture_date, r.created_at) DESC, r.id DESC
     LIMIT 1`,
    storeId,
    checksum,
  );
  return row ? mapDuplicateCandidate(row) : null;
}

async function findDuplicateCandidateBySourceDocument(
  database: OutboxDatabase,
  sourceDocumentId: string,
): Promise<LocalWasteDuplicateCandidate | null> {
  const row = await database.getFirstAsync<DuplicateCandidateRow>(
    `SELECT r.id AS receipt_id, d.id AS source_document_id, r.capture_date,
            r.processing_status, f.local_uri
     FROM source_documents d
     JOIN waste_receipts r ON r.source_document_id = d.id
     LEFT JOIN local_files f ON f.id = r.local_file_id
     WHERE d.id = ? AND d.deleted_at IS NULL AND r.deleted_at IS NULL
     ORDER BY COALESCE(r.capture_date, r.created_at) DESC, r.id DESC
     LIMIT 1`,
    sourceDocumentId,
  );
  return row ? mapDuplicateCandidate(row) : null;
}

function mapDuplicateCandidate(
  row: DuplicateCandidateRow,
): LocalWasteDuplicateCandidate {
  return {
    receiptId: row.receipt_id,
    sourceDocumentId: row.source_document_id,
    captureDate: row.capture_date,
    processingStatus: row.processing_status,
    localFileUri: row.local_uri,
  };
}

function assertAggregate(
  receipt: WasteReceipt,
  file: LocalFileMetadata,
  lines: readonly WasteLine[],
  document?: LocalSourceDocument,
) {
  if (receipt.localFileId !== file.id) {
    throw new Error("Waste receipt must reference its local source file.");
  }
  if (receipt.storeId !== file.storeId) {
    throw new Error("Waste receipt and local source file must share a store.");
  }
  if (receipt.sourceDocumentId !== file.sourceDocumentId) {
    throw new Error("Waste receipt and local source file lineage must match.");
  }
  if (
    document &&
    (document.id !== receipt.sourceDocumentId ||
      document.storeId !== receipt.storeId ||
      document.localFileUri !== file.localUri ||
      document.checksum !== file.checksum)
  ) {
    throw new Error("Waste receipt source document lineage must match.");
  }
  for (const line of lines) {
    if (line.receiptId !== receipt.id || line.storeId !== receipt.storeId) {
      throw new Error("Waste line must belong to its receipt and store.");
    }
  }
}

export async function insertSourceDocument(
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

async function insertUploadJob(
  database: OutboxDatabase,
  jobId: string,
  payload: { storeId: string; sourceDocumentId: string; localFileId: string },
  timestamp: string,
) {
  await database.runAsync(
    `
      INSERT INTO local_jobs (
        id, type, payload_json, status, attempt_count, next_attempt_at,
        last_error, created_at, updated_at
      ) VALUES (?, 'SOURCE_UPLOAD_AND_REGISTER', ?, 'PENDING', 0, NULL, NULL, ?, ?)
    `,
    jobId,
    JSON.stringify(payload),
    timestamp,
    timestamp,
  );
}

async function insertLocalFile(
  database: OutboxDatabase,
  file: LocalFileMetadata,
) {
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

export async function insertReceipt(
  database: OutboxDatabase,
  receipt: WasteReceipt,
) {
  await database.runAsync(
    `
      INSERT INTO waste_receipts (
        id, store_id, source_document_id, local_file_id, capture_date,
        detected_receipt_date, confirmed_waste_date, processing_status,
        ai_status, duplicate_status, duplicate_candidate_source_document_id,
        duplicate_reason, note, version, created_at, updated_at, deleted_at,
        sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    receipt.id,
    receipt.storeId,
    receipt.sourceDocumentId ?? null,
    receipt.localFileId ?? null,
    receipt.captureDate ?? null,
    receipt.detectedReceiptDate ?? null,
    receipt.confirmedWasteDate ?? null,
    receipt.processingStatus,
    receipt.aiStatus,
    receipt.duplicateStatus,
    receipt.duplicateCandidateSourceDocumentId ?? null,
    receipt.duplicateReason ?? null,
    receipt.note ?? null,
    receipt.version,
    receipt.createdAt,
    receipt.updatedAt,
    receipt.deletedAt ?? null,
    receipt.syncState,
    receipt.remoteVersion ?? null,
    receipt.dirty ? 1 : 0,
  );
}

export async function insertLine(database: OutboxDatabase, line: WasteLine) {
  await database.runAsync(
    `
      INSERT INTO waste_lines (
        id, store_id, receipt_id, source_line_index, raw_label, quantity,
        weight, quantity_unit, unit_price, total_price, matched_product_id,
        match_status, match_confidence, product_nature,
        extraction_confidence_json, source_region_json, validation_status,
        version, created_at, updated_at, deleted_at, sync_state,
        remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    line.id,
    line.storeId,
    line.receiptId,
    line.sourceLineIndex,
    line.rawLabel,
    line.quantity ?? null,
    line.weight ?? null,
    line.quantityUnit ?? null,
    line.unitPrice ?? null,
    line.totalPrice ?? null,
    line.matchedProductId ?? null,
    line.matchStatus,
    line.matchConfidence ?? null,
    line.productNature,
    line.extractionConfidence === null ||
      line.extractionConfidence === undefined
      ? null
      : JSON.stringify(line.extractionConfidence),
    line.sourceRegion === null || line.sourceRegion === undefined
      ? null
      : JSON.stringify(line.sourceRegion),
    line.validationStatus,
    line.version,
    line.createdAt,
    line.updatedAt,
    line.deletedAt ?? null,
    line.syncState,
    line.remoteVersion ?? null,
    line.dirty ? 1 : 0,
  );
}

function mapReceipt(row: WasteReceiptRow) {
  return wasteReceiptSchema.parse({
    id: row.id,
    storeId: row.store_id,
    sourceDocumentId: row.source_document_id,
    localFileId: row.local_file_id,
    captureDate: row.capture_date,
    detectedReceiptDate: row.detected_receipt_date,
    confirmedWasteDate: row.confirmed_waste_date,
    processingStatus: row.processing_status,
    aiStatus: row.ai_status,
    duplicateStatus: row.duplicate_status,
    duplicateCandidateSourceDocumentId:
      row.duplicate_candidate_source_document_id,
    duplicateReason: row.duplicate_reason,
    note: row.note,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    dirty: row.dirty === 1,
  });
}

function mapLine(row: WasteLineRow) {
  return wasteLineSchema.parse({
    id: row.id,
    storeId: row.store_id,
    receiptId: row.receipt_id,
    sourceLineIndex: row.source_line_index,
    rawLabel: row.raw_label,
    quantity: row.quantity,
    weight: row.weight,
    quantityUnit: row.quantity_unit,
    unitPrice: row.unit_price,
    totalPrice: row.total_price,
    matchedProductId: row.matched_product_id,
    matchStatus: row.match_status,
    matchConfidence: row.match_confidence,
    productNature: row.product_nature,
    extractionConfidence: parseNullableJson(row.extraction_confidence_json),
    sourceRegion: parseNullableJson(row.source_region_json),
    validationStatus: row.validation_status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    dirty: row.dirty === 1,
  });
}

function mapLineDraft(row: WasteLineRow): LocalWasteLineDraft {
  return {
    line: mapLine(row),
    arithmeticStatus: row.arithmetic_status,
    arithmeticExpectedTotal: row.arithmetic_expected_total,
    arithmeticDifference: row.arithmetic_difference,
    arithmeticWarningCode: row.arithmetic_warning_code,
    matchState: row.match_state,
    matchedProductLabel: row.matched_product_label,
    candidates: parseCandidates(row.match_candidates_json),
  };
}

function localMatchStatus(
  state: WasteReceiptDraft["lines"][number]["matchState"],
) {
  if (state === "AUTO_MATCH") return "MATCHED";
  if (state === "NO_MATCH") return "UNMATCHED";
  return "AMBIGUOUS";
}

function nullableDecimal(value: string | null) {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("WASTE_RECEIPT_DECIMAL_INVALID");
  }
  return normalized;
}

function parseCandidates(value: string | null): WasteReceiptDraftCandidate[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as WasteReceiptDraftCandidate[];
  return Array.isArray(parsed) ? parsed : [];
}

function parseNullableJson(value: string | null) {
  return value === null ? null : (JSON.parse(value) as unknown);
}

interface WasteReceiptRow {
  id: string;
  store_id: string;
  source_document_id: string | null;
  local_file_id: string | null;
  capture_date: string | null;
  detected_receipt_date: string | null;
  confirmed_waste_date: string | null;
  processing_status: string;
  ai_status: string;
  duplicate_status: string;
  duplicate_candidate_source_document_id: string | null;
  duplicate_reason: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: string;
  remote_version: number | null;
  dirty: number;
}

interface DuplicateCandidateRow {
  receipt_id: string;
  source_document_id: string;
  capture_date: string | null;
  processing_status: WasteReceipt["processingStatus"];
  local_uri: string | null;
}

interface WasteReceiptSummaryRow extends WasteReceiptRow {
  local_uri: string | null;
  line_count: number;
}

interface WasteLineRow {
  id: string;
  store_id: string;
  receipt_id: string;
  source_line_index: number;
  raw_label: string;
  quantity: string | null;
  weight: string | null;
  quantity_unit: string | null;
  unit_price: string | null;
  total_price: string | null;
  matched_product_id: string | null;
  match_status: string;
  match_confidence: number | null;
  product_nature: string;
  extraction_confidence_json: string | null;
  source_region_json: string | null;
  validation_status: string;
  arithmetic_status: "NOT_CHECKED" | "CONSISTENT" | "MISMATCH";
  arithmetic_expected_total: string | null;
  arithmetic_difference: string | null;
  arithmetic_warning_code: "AMOUNT_TO_REVIEW" | null;
  match_state: "AUTO_MATCH" | "REVIEW" | "AMBIGUOUS" | "NO_MATCH";
  matched_product_label: string | null;
  match_candidates_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: string;
  remote_version: number | null;
  dirty: number;
}

interface UploadJobRow {
  id: string;
  status: string;
  last_error: string | null;
  next_attempt_at: string | null;
  attempt_count: number;
  source_document_id: string;
}
function mapUploadJob(row: UploadJobRow): LocalWasteReceiptUploadJob {
  return {
    id: row.id,
    status: row.status,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
  };
}
