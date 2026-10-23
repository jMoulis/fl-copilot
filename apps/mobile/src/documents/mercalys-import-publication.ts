import {
  enqueueMercalysPublications,
  enqueueMercalysContinuation,
  readMercalysPublication,
} from "./mercalys-publication-sync";
import {
  canonicalMercalysRecords,
  type ParsedMercalysArticleRecord,
} from "@fl-copilot/import-core";
import {
  salesObservationSchema,
  productMatchResultSchema,
  sourceRecordSchema,
  wasteObservationSchema,
  type ProductNature,
  type SalesObservation,
  type SourceRecord,
  type WasteObservation,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";
import type {
  MercalysImportValidationLine,
  MercalysImportValidationSummary,
} from "./mercalys-import-validation";
import {
  analyzeMercalysReconciliation,
  type MercalysReconciliation,
} from "./mercalys-import-reconciliation";
import type { MercalysSourceType } from "./mercalys-source-detector";

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
  reconciliationApproval?: {
    fingerprint: string;
    actorUserId: string;
  };
}

export interface PublishedMercalysImport {
  sourceDocumentId: string;
  localFileId: string;
  analyticsJobId: string;
  publishedCount: number;
  remainingCount: number;
  replacedCount: number;
}

export interface ExactDuplicateImport {
  sourceDocumentId: string;
  sourceType: MercalysSourceType;
  originalFilename: string | null;
  businessPeriodStart: string | null;
  businessPeriodEnd: string | null;
  localProcessingStatus: string;
  remoteProcessingStatus: string | null;
  createdAt: string;
}

export class MercalysExactDuplicateError extends Error {
  constructor(readonly priorImport: ExactDuplicateImport) {
    super("MERCALYS_EXACT_DUPLICATE");
    this.name = "MercalysExactDuplicateError";
  }
}

export class MercalysOverlapReconciliationError extends Error {
  constructor(readonly reconciliation: MercalysReconciliation) {
    super("MERCALYS_RECONCILIATION_REQUIRED");
    this.name = "MercalysOverlapReconciliationError";
  }
}

export class MercalysImportPublicationRepository {
  constructor(
    private readonly database: PublicationDatabase,
    private readonly generateId: GenerateId,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async findExactDuplicate(
    storeId: string,
    sourceType: MercalysSourceType,
    checksum: string,
  ) {
    return findExactDuplicate(this.database, storeId, sourceType, checksum);
  }

  async analyzeOverlap(
    storeId: string,
    summary: MercalysImportValidationSummary,
  ) {
    return analyzeMercalysReconciliation(this.database, storeId, summary);
  }

  /** Retain historical mappings and source-row IDs; only WARNING rows may be completed. */
  async continuation(
    storeId: string,
    checksum: string,
    summary: MercalysImportValidationSummary,
  ) {
    const duplicate = await this.findExactDuplicate(
      storeId,
      summary.sourceType,
      checksum,
    );
    if (!duplicate) return null;
    const publication = await readMercalysPublication(
      this.database,
      storeId,
      duplicate.sourceDocumentId,
    );
    if (
      !publication ||
      publication.source.checksum !== checksum ||
      publication.source.businessPeriodStart !== summary.businessPeriodStart ||
      publication.source.businessPeriodEnd !== summary.businessPeriodEnd ||
      publication.source.parserVersion !== summary.parserVersion ||
      publication.records.length !== summary.lines.length
    )
      throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
    if ([...publication.sales, ...publication.waste].some((o) => o.deletedAt))
      throw Error("MERCALYS_CONTINUATION_SUPERSEDED");
    const state = await this.database.getFirstAsync<{ sync_state: string }>(
      "SELECT sync_state FROM source_documents WHERE id=? AND store_id=?",
      publication.source.id,
      storeId,
    );
    if (
      !state ||
      ["ERROR", "CONFLICT"].includes(state.sync_state) ||
      (await this.database.getFirstAsync(
        "SELECT command_id FROM sync_outbox WHERE store_id=? AND entity_type='mercalys_publication' AND entity_id=? AND status IN ('CONFLICT','FAILED') LIMIT 1",
        storeId,
        publication.source.id,
      ))
    )
      throw Error("MERCALYS_CONTINUATION_CONFLICT");
    const records = new Map(publication.records.map((r) => [r.sourceIndex, r]));
    const lines = summary.lines.map((line) => {
      const old = records.get(line.record.sourceIndex);
      if (
        !old ||
        !["PUBLISHED", "WARNING"].includes(old.status) ||
        JSON.stringify(
          canonicalMercalysRecords([
            old.normalizedPayload as unknown as ParsedMercalysArticleRecord,
          ]),
        ) !== JSON.stringify(canonicalMercalysRecords([line.record]))
      )
        throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
      return old.status === "PUBLISHED"
        ? {
            ...line,
            match: productMatchResultSchema.parse(
              (old.normalizedPayload as Record<string, unknown>).match,
            ),
          }
        : line;
    });
    const readyCount = lines.filter(
      (line) => line.match.state === "AUTO_MATCH",
    ).length;
    const table =
      summary.sourceType === "MERCALYS_SALES"
        ? "sales_observations"
        : "waste_observations";
    const others = await this.database.getAllAsync<{
      product_id: string;
      business_date: string;
    }>(
      `SELECT product_id,business_date FROM ${table} WHERE store_id=? AND source_document_id!=? AND business_date>=? AND business_date<=? AND deleted_at IS NULL ${table === "waste_observations" ? "AND source_type='MERCALYS'" : ""}`,
      storeId,
      publication.source.id,
      summary.businessPeriodStart,
      summary.businessPeriodEnd,
    );
    const occupied = new Set(
      others.map((o) => `${o.product_id}:${o.business_date}`),
    );
    if (
      lines.some(
        (line) =>
          records.get(line.record.sourceIndex)?.status === "WARNING" &&
          line.match.state === "AUTO_MATCH" &&
          occupied.has(
            `${line.match.matchedProductId}:${line.record.businessDate}`,
          ),
      )
    )
      throw Error("MERCALYS_CONTINUATION_OVERLAP");
    return {
      sourceDocumentId: publication.source.id,
      publication,
      publishedCount: publication.records.filter(
        (r) => r.status === "PUBLISHED",
      ).length,
      remainingCount:
        publication.records.filter((r) => r.status !== "PUBLISHED").length +
        summary.errorCount,
      summary: {
        ...summary,
        lines,
        readyCount,
        productReviewCount: lines.length - readyCount,
      },
    };
  }

  /** Complete an existing partial source atomically; never replace its published observations. */
  async resume(
    input: Pick<
      PublishMercalysImportInput,
      "storeId" | "checksum" | "summary"
    > & { sourceDocumentId: string },
  ): Promise<
    Pick<
      PublishedMercalysImport,
      "sourceDocumentId" | "publishedCount" | "remainingCount" | "replacedCount"
    >
  > {
    let result:
      | Pick<
          PublishedMercalysImport,
          | "sourceDocumentId"
          | "publishedCount"
          | "remainingCount"
          | "replacedCount"
        >
      | undefined;
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      const joined = {
        getFirstAsync: tx.getFirstAsync.bind(tx),
        getAllAsync: tx.getAllAsync.bind(tx),
        runAsync: tx.runAsync.bind(tx),
        withExclusiveTransactionAsync: (
          task: (db: OutboxDatabase) => Promise<void>,
        ) => task(tx),
      };
      const current = await new MercalysImportPublicationRepository(
        joined,
        this.generateId,
        this.now,
      ).continuation(input.storeId, input.checksum, input.summary);
      if (!current || current.sourceDocumentId !== input.sourceDocumentId)
        throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
      const byIndex = new Map(
        current.publication.records.map((r) => [r.sourceIndex, r]),
      );
      const additions = current.summary.lines.filter(
        (l) =>
          byIndex.get(l.record.sourceIndex)?.status === "WARNING" &&
          l.match.state === "AUTO_MATCH" &&
          l.match.matchedProductId,
      );
      const now = this.now(),
        jobId = this.generateId();
      for (const line of additions) {
        const record = byIndex.get(line.record.sourceIndex)!;
        await insertObservationFromLine(
          tx,
          input.storeId,
          current.summary.sourceType,
          input.sourceDocumentId,
          record.id,
          line,
          this.generateId,
          now,
        );
        const changed = await tx.runAsync(
          "UPDATE source_records SET normalized_payload_json=?,status='PUBLISHED',warning_codes_json='[]',version=version+1,updated_at=? WHERE id=? AND store_id=? AND source_document_id=? AND status='WARNING' AND version=?",
          JSON.stringify({
            ...(record.normalizedPayload as Record<string, unknown>),
            match: line.match,
          }),
          now,
          record.id,
          input.storeId,
          input.sourceDocumentId,
          record.version,
        );
        if (Number(changed.changes) !== 1)
          throw Error("MERCALYS_CONTINUATION_SOURCE_CHANGED");
      }
      if (additions.length) {
        await enqueueAnalyticsRecomputationJob(tx, {
          jobId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
          scopes: additions.map((l) => ({
            productId: l.match.matchedProductId!,
            businessDate: l.record.businessDate,
          })),
          createdAt: now,
        });
        await enqueueMercalysContinuation(
          tx,
          input.storeId,
          input.sourceDocumentId,
          this.generateId,
          now,
        );
      }
      result = {
        sourceDocumentId: input.sourceDocumentId,
        publishedCount: additions.length,
        remainingCount: current.remainingCount - additions.length,
        replacedCount: 0,
      };
    });
    return result!;
  }

  async keepExisting(input: {
    storeId: string;
    filename: string;
    checksum: string;
    summary: MercalysImportValidationSummary;
    reconciliation: MercalysReconciliation;
    actorUserId: string;
  }) {
    const reconciliationId = this.generateId();
    const resolvedAt = this.now();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await analyzeMercalysReconciliation(
        transaction,
        input.storeId,
        input.summary,
      );
      assertCurrentReconciliation(current, input.reconciliation.fingerprint);
      await insertReconciliationAudit(transaction, {
        id: reconciliationId,
        storeId: input.storeId,
        filename: input.filename,
        checksum: input.checksum,
        reconciliation: current,
        decision: "KEEP_EXISTING",
        actorUserId: input.actorUserId,
        newSourceDocumentId: null,
        resolvedAt,
      });
    });
    return { reconciliationId };
  }

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
    const analyticsJobId = this.generateId();
    const reconciliationId = input.reconciliationApproval
      ? this.generateId()
      : null;
    let publishedCount = 0;
    let replacedCount = 0;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const duplicate = await findExactDuplicate(
        transaction,
        input.storeId,
        input.summary.sourceType,
        input.checksum,
      );
      if (duplicate) throw new MercalysExactDuplicateError(duplicate);

      const reconciliation = await analyzeMercalysReconciliation(
        transaction,
        input.storeId,
        input.summary,
      );
      if (reconciliation) {
        if (!input.reconciliationApproval) {
          throw new MercalysOverlapReconciliationError(reconciliation);
        }
        assertCurrentReconciliation(
          reconciliation,
          input.reconciliationApproval.fingerprint,
        );
        if (!reconciliation.safeToApply) {
          throw new Error("Ambiguous reconciliation cannot be applied.");
        }
        const ids = reconciliation.rows.flatMap(
          (row) => row.existingObservationIds,
        );
        replacedCount = await softDeleteObservations(
          transaction,
          input.summary.sourceType,
          ids,
          createdAt,
        );
      } else if (input.reconciliationApproval) {
        throw new Error("Reconciliation is no longer required.");
      }

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

        await insertObservationFromLine(
          transaction,
          input.storeId,
          input.summary.sourceType,
          sourceDocumentId,
          sourceRecordId,
          line,
          this.generateId,
          createdAt,
        );
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

      await enqueueAnalyticsRecomputationJob(transaction, {
        jobId: analyticsJobId,
        storeId: input.storeId,
        sourceDocumentId,
        scopes: [
          ...readyLines.map((line) => ({
            productId: line.match.matchedProductId!,
            businessDate: line.record.businessDate,
          })),
          ...(reconciliation?.rows.flatMap((row) =>
            (row.existingProductIds ?? []).map((productId) => ({
              productId,
              businessDate: row.businessDate,
            })),
          ) ?? []),
        ],
        createdAt,
      });

      if (reconciliation && reconciliationId && input.reconciliationApproval) {
        await insertReconciliationAudit(transaction, {
          id: reconciliationId,
          storeId: input.storeId,
          filename: input.filename,
          checksum: input.checksum,
          reconciliation,
          decision: "APPLY_NEW",
          actorUserId: input.reconciliationApproval.actorUserId,
          newSourceDocumentId: sourceDocumentId,
          resolvedAt: createdAt,
        });
      }
      await enqueueMercalysPublications(
        transaction,
        input.storeId,
        this.generateId,
        createdAt,
        [sourceDocumentId, ...(reconciliation?.priorSourceDocumentIds ?? [])],
      );
    });

    return {
      sourceDocumentId,
      localFileId,
      analyticsJobId,
      publishedCount,
      remainingCount:
        input.summary.productReviewCount + input.summary.errorCount,
      replacedCount,
    };
  }
}

function assertCurrentReconciliation(
  current: MercalysReconciliation | null,
  expectedFingerprint: string,
): asserts current is MercalysReconciliation {
  if (!current) throw new Error("Reconciliation is no longer required.");
  if (current.fingerprint !== expectedFingerprint) {
    throw new MercalysOverlapReconciliationError(current);
  }
}

async function softDeleteObservations(
  database: OutboxDatabase,
  sourceType: MercalysSourceType,
  observationIds: string[],
  updatedAt: string,
) {
  const table =
    sourceType === "MERCALYS_SALES"
      ? "sales_observations"
      : "waste_observations";
  let count = 0;
  for (const id of [...new Set(observationIds)]) {
    const result = await database.runAsync(
      `
        UPDATE ${table}
        SET deleted_at = ?, updated_at = ?, version = version + 1,
            sync_state = 'PENDING', dirty = 1
        WHERE id = ? AND deleted_at IS NULL
      `,
      updatedAt,
      updatedAt,
      id,
    );
    count += Number(result.changes);
  }
  if (count !== new Set(observationIds).size) {
    throw new Error("Reconciliation observations changed during publication.");
  }
  return count;
}

async function insertReconciliationAudit(
  database: OutboxDatabase,
  input: {
    id: string;
    storeId: string;
    filename: string;
    checksum: string;
    reconciliation: MercalysReconciliation;
    decision: "APPLY_NEW" | "KEEP_EXISTING";
    actorUserId: string;
    newSourceDocumentId: string | null;
    resolvedAt: string;
  },
) {
  await database.runAsync(
    `
      INSERT INTO import_reconciliations (
        id, store_id, source_type, incoming_checksum, incoming_filename,
        business_period_start, business_period_end,
        prior_source_document_ids_json, classification_json, decision,
        actor_user_id, new_source_document_id, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.id,
    input.storeId,
    input.reconciliation.sourceType,
    input.checksum,
    input.filename,
    input.reconciliation.businessPeriodStart,
    input.reconciliation.businessPeriodEnd,
    JSON.stringify(input.reconciliation.priorSourceDocumentIds),
    JSON.stringify(input.reconciliation),
    input.decision,
    input.actorUserId,
    input.newSourceDocumentId,
    input.resolvedAt,
    input.resolvedAt,
  );
}

async function findExactDuplicate(
  database: OutboxDatabase,
  storeId: string,
  sourceType: MercalysSourceType,
  checksum: string,
): Promise<ExactDuplicateImport | null> {
  const row = await database.getFirstAsync<{
    id: string;
    source_type: MercalysSourceType;
    original_filename: string | null;
    business_period_start: string | null;
    business_period_end: string | null;
    local_processing_status: string;
    remote_processing_status: string | null;
    created_at: string;
  }>(
    `
      SELECT id, source_type, original_filename, business_period_start,
             business_period_end, local_processing_status,
             remote_processing_status, created_at
      FROM source_documents
      WHERE store_id = ? AND source_type = ? AND checksum = ?
        AND local_processing_status NOT IN ('FAILED', 'CANCELLED')
        AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    storeId,
    sourceType,
    checksum,
  );
  return row
    ? {
        sourceDocumentId: row.id,
        sourceType: row.source_type,
        originalFilename: row.original_filename,
        businessPeriodStart: row.business_period_start,
        businessPeriodEnd: row.business_period_end,
        localProcessingStatus: row.local_processing_status,
        remoteProcessingStatus: row.remote_processing_status,
        createdAt: row.created_at,
      }
    : null;
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

async function insertObservationFromLine(
  transaction: OutboxDatabase,
  storeId: string,
  sourceType: MercalysSourceType,
  sourceDocumentId: string,
  sourceRecordId: string,
  line: MercalysImportValidationLine,
  generateId: GenerateId,
  createdAt: string,
) {
  if (!line.match.matchedProductId) throw Error("MERCALYS_PRODUCT_REQUIRED");
  const product = await activeProduct(
    transaction,
    storeId,
    line.match.matchedProductId,
  );
  if (!product) {
    throw new Error("Matched product is no longer active in this store.");
  }

  if (sourceType === "MERCALYS_SALES") {
    await insertSalesObservation(
      transaction,
      salesObservationSchema.parse({
        id: generateId(),
        storeId,
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
        id: generateId(),
        storeId,
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
}
