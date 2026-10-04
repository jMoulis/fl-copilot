import {
  localFileMetadataSchema,
  wasteLineSchema,
  wasteReceiptSchema,
  type LocalFileMetadata,
  type WasteLine,
  type WasteReceipt,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

export interface LocalWasteReceiptAggregate {
  receipt: WasteReceipt;
  file: LocalFileMetadata;
  lines?: readonly WasteLine[];
}

export interface LocalWasteReceiptSummary {
  receipt: WasteReceipt;
  localFileUri: string | null;
  lineCount: number;
}

export interface CreateCapturedWasteReceiptInput {
  receiptId: string;
  fileId: string;
  storeId: string;
  capturedAt: string;
  file: {
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

  createCapturedDraft(input: CreateCapturedWasteReceiptInput) {
    return this.createDraft({
      receipt: {
        id: input.receiptId,
        storeId: input.storeId,
        sourceDocumentId: null,
        localFileId: input.fileId,
        captureDate: input.capturedAt,
        detectedReceiptDate: null,
        confirmedWasteDate: null,
        processingStatus: "CAPTURED",
        aiStatus: "PENDING",
        duplicateStatus: "UNCHECKED",
        note: null,
        version: 1,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
        deletedAt: null,
        syncState: "LOCAL_ONLY",
        remoteVersion: null,
        dirty: true,
      },
      file: {
        id: input.fileId,
        storeId: input.storeId,
        sourceDocumentId: null,
        localUri: input.file.localUri,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.sizeBytes,
        checksum: input.file.checksum,
        retentionStatus: "RETAINED",
        uploadStatus: "LOCAL_ONLY",
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
      },
    });
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
    return rows.map((row) => ({
      receipt: mapReceipt(row),
      localFileUri: row.local_uri,
      lineCount: Number(row.line_count),
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
}

function assertAggregate(
  receipt: WasteReceipt,
  file: LocalFileMetadata,
  lines: readonly WasteLine[],
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
  for (const line of lines) {
    if (line.receiptId !== receipt.id || line.storeId !== receipt.storeId) {
      throw new Error("Waste line must belong to its receipt and store.");
    }
  }
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

async function insertReceipt(database: OutboxDatabase, receipt: WasteReceipt) {
  await database.runAsync(
    `
      INSERT INTO waste_receipts (
        id, store_id, source_document_id, local_file_id, capture_date,
        detected_receipt_date, confirmed_waste_date, processing_status,
        ai_status, duplicate_status, note, version, created_at, updated_at,
        deleted_at, sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function insertLine(database: OutboxDatabase, line: WasteLine) {
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
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: string;
  remote_version: number | null;
  dirty: number;
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
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: string;
  remote_version: number | null;
  dirty: number;
}
