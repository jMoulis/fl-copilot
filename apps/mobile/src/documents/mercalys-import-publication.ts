import {
  salesObservationSchema,
  sourceRecordSchema,
  wasteObservationSchema,
  type ProductNature,
  type SalesObservation,
  type SourceRecord,
  type WasteObservation,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";

type PublicationDatabase = AtomicMutationDatabase & OutboxDatabase;
type GenerateId = () => string;

export interface PublishMercalysImportInput {
  storeId: string;
  filename: string;
  localFileUri: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  summary: MercalysImportValidationSummary;
}

export interface PublishedMercalysImport {
  sourceDocumentId: string;
  localFileId: string;
  publishedCount: number;
  remainingCount: number;
}

export class MercalysImportPublicationRepository {
  constructor(
    private readonly database: PublicationDatabase,
    private readonly generateId: GenerateId,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async publish(
    input: PublishMercalysImportInput,
  ): Promise<PublishedMercalysImport> {
    const readyLines = input.summary.lines.filter(
      ({ match }) =>
        match.state === "AUTO_MATCH" && match.matchedProductId !== null,
    );
    if (readyLines.length === 0) {
      throw new Error("No validated Mercalys line is ready for publication.");
    }

    const createdAt = this.now();
    const sourceDocumentId = this.generateId();
    const localFileId = this.generateId();
    const jobId = this.generateId();
    let publishedCount = 0;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await insertDocument(transaction, {
        id: sourceDocumentId,
        ...input,
        createdAt,
      });
      await insertFile(transaction, {
        id: localFileId,
        sourceDocumentId,
        ...input,
        createdAt,
      });

      for (const line of input.summary.lines) {
        const sourceRecordId = this.generateId();
        const ready =
          line.match.state === "AUTO_MATCH" &&
          line.match.matchedProductId !== null;
        const record = sourceRecordSchema.parse({
          id: sourceRecordId,
          storeId: input.storeId,
          sourceDocumentId,
          sourceIndex: line.record.sourceIndex,
          sourcePage: null,
          rawPayload: line.record.rawValues,
          normalizedPayload: {
            ...line.record,
            match: line.match,
          },
          status: ready ? "PUBLISHED" : "WARNING",
          errorCodes: [],
          warningCodes: ready ? [] : ["PRODUCT_REVIEW_REQUIRED"],
          version: 1,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
        await insertSourceRecord(transaction, record);
        if (!ready || !line.match.matchedProductId) continue;

        const product = await activeProduct(
          transaction,
          input.storeId,
          line.match.matchedProductId,
        );
        if (!product) {
          throw new Error("Matched product is no longer active in this store.");
        }

        if (input.summary.sourceType === "MERCALYS_SALES") {
          await insertSalesObservation(
            transaction,
            salesObservationSchema.parse({
              id: this.generateId(),
              storeId: input.storeId,
              productId: product.id,
              businessDate: line.record.businessDate,
              quantity: decimal(line.record.quantity),
              purchaseValue: nullableDecimal(line.record.purchaseValue),
              rceValue: nullableDecimal(line.record.rceValue),
              salesValue: nullableDecimal(line.record.salesValue),
              vatValue: nullableDecimal(line.record.vatValue),
              marginValue: nullableDecimal(line.record.marginValue),
              marginRate: nullableDecimal(line.record.marginRate),
              sourceDocumentId,
              sourceRecordId,
              validationStatus: "VALIDATED",
              version: 1,
              createdAt,
              updatedAt: createdAt,
              deletedAt: null,
              syncState: "PENDING",
              remoteVersion: null,
              dirty: true,
            }),
          );
        } else {
          await insertWasteObservation(
            transaction,
            wasteObservationSchema.parse({
              id: this.generateId(),
              storeId: input.storeId,
              productId: product.id,
              businessDate: line.record.businessDate,
              productNature: product.nature,
              quantity: decimal(line.record.quantity),
              purchaseValueKnown: nullableDecimal(line.record.purchaseValue),
              purchaseValueEstimated: null,
              salesValue: nullableDecimal(line.record.salesValue),
              costQuality:
                line.record.purchaseValue === null ? "UNAVAILABLE" : "KNOWN",
              sourceType: "MERCALYS",
              sourceDocumentId,
              sourceRecordId,
              validationStatus: "VALIDATED",
              version: 1,
              createdAt,
              updatedAt: createdAt,
              deletedAt: null,
              syncState: "PENDING",
              remoteVersion: null,
              dirty: true,
            }),
          );
        }
        publishedCount += 1;
      }

      await transaction.runAsync(
        `
          INSERT INTO local_jobs (
            id, type, payload_json, status, attempt_count, next_attempt_at,
            last_error, created_at, updated_at
          ) VALUES (?, 'SOURCE_UPLOAD_AND_REGISTER', ?, 'PENDING', 0, NULL, NULL, ?, ?)
        `,
        jobId,
        JSON.stringify({
          storeId: input.storeId,
          sourceDocumentId,
          localFileId,
        }),
        createdAt,
        createdAt,
      );
    });

    return {
      sourceDocumentId,
      localFileId,
      publishedCount,
      remainingCount:
        input.summary.productReviewCount + input.summary.errorCount,
    };
  }
}

async function activeProduct(
  database: OutboxDatabase,
  storeId: string,
  productId: string,
) {
  return database.getFirstAsync<{ id: string; nature: ProductNature }>(
    `
      SELECT id, nature FROM products
      WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
        AND deleted_at IS NULL
    `,
    productId,
    storeId,
  );
}

async function insertDocument(
  database: OutboxDatabase,
  input: PublishMercalysImportInput & { id: string; createdAt: string },
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
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'PUBLISHED', 'PENDING', NULL, ?, NULL, 1, ?, ?, NULL, 'PENDING', NULL, 1)
    `,
    input.id,
    input.storeId,
    input.summary.sourceType,
    input.filename,
    input.localFileUri,
    input.checksum,
    input.summary.businessPeriodStart,
    input.summary.businessPeriodEnd,
    input.summary.parserVersion,
    input.createdAt,
    input.createdAt,
  );
}

async function insertFile(
  database: OutboxDatabase,
  input: PublishMercalysImportInput & {
    id: string;
    sourceDocumentId: string;
    createdAt: string;
  },
) {
  await database.runAsync(
    `
      INSERT INTO local_files (
        id, store_id, source_document_id, local_uri, mime_type, size_bytes,
        checksum, retention_status, upload_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RETAINED', 'PENDING', ?, ?)
    `,
    input.id,
    input.storeId,
    input.sourceDocumentId,
    input.localFileUri,
    input.mimeType,
    input.sizeBytes,
    input.checksum,
    input.createdAt,
    input.createdAt,
  );
}

async function insertSourceRecord(
  database: OutboxDatabase,
  record: SourceRecord,
) {
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
    JSON.stringify(record.normalizedPayload),
    record.status,
    JSON.stringify(record.errorCodes),
    JSON.stringify(record.warningCodes),
    record.version,
    record.createdAt,
    record.updatedAt,
    record.deletedAt ?? null,
  );
}

async function insertSalesObservation(
  database: OutboxDatabase,
  observation: SalesObservation,
) {
  await database.runAsync(
    `
      INSERT INTO sales_observations (
        id, store_id, product_id, business_date, quantity, purchase_value,
        rce_value, sales_value, vat_value, margin_value, margin_rate,
        source_document_id, source_record_id, validation_status, version,
        created_at, updated_at, deleted_at, sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    observation.id,
    observation.storeId,
    observation.productId,
    observation.businessDate,
    observation.quantity,
    observation.purchaseValue,
    observation.rceValue,
    observation.salesValue,
    observation.vatValue,
    observation.marginValue,
    observation.marginRate,
    observation.sourceDocumentId,
    observation.sourceRecordId,
    observation.validationStatus,
    observation.version,
    observation.createdAt,
    observation.updatedAt,
    observation.deletedAt,
    observation.syncState,
    observation.remoteVersion,
    observation.dirty ? 1 : 0,
  );
}

async function insertWasteObservation(
  database: OutboxDatabase,
  observation: WasteObservation,
) {
  await database.runAsync(
    `
      INSERT INTO waste_observations (
        id, store_id, product_id, business_date, product_nature, quantity,
        purchase_value_known, purchase_value_estimated, sales_value,
        cost_quality, source_type, source_document_id, source_record_id,
        validation_status, version, created_at, updated_at, deleted_at,
        sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    observation.id,
    observation.storeId,
    observation.productId,
    observation.businessDate,
    observation.productNature,
    observation.quantity,
    observation.purchaseValueKnown,
    observation.purchaseValueEstimated,
    observation.salesValue,
    observation.costQuality,
    observation.sourceType,
    observation.sourceDocumentId,
    observation.sourceRecordId,
    observation.validationStatus,
    observation.version,
    observation.createdAt,
    observation.updatedAt,
    observation.deletedAt,
    observation.syncState,
    observation.remoteVersion,
    observation.dirty ? 1 : 0,
  );
}

function decimal(value: number) {
  return String(value);
}

function nullableDecimal(value: number | null) {
  return value === null ? null : decimal(value);
}
