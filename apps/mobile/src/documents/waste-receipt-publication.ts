import {
  wastePublicationSchema,
  synchronizedWastePublicationSchema,
  type WastePublication,
} from "@fl-copilot/sync-contracts";
import {
  type LocalSourceDocument,
  type Product,
  type WasteObservation,
} from "@fl-copilot/domain";
import { validateWasteReceiptArithmetic } from "@fl-copilot/analytics-core";
import {
  WasteReceiptRepository,
  insertSourceDocument,
  insertReceipt,
  insertLine,
} from "./waste-receipt-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";

export class WasteReceiptPublicationRepository {
  constructor(
    private readonly database: OutboxDatabase & AtomicMutationDatabase,
  ) {}
  async publish(input: {
    receiptId: string;
    storeId: string;
    deviceId: string;
    commandId: string;
    analyticsJobId: string;
    timestamp: string;
  }) {
    let count = 0;
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      const repository = new WasteReceiptRepository({
        ...tx,
        withExclusiveTransactionAsync: async (task) => task(tx),
        getFirstAsync: tx.getFirstAsync.bind(tx),
        getAllAsync: tx.getAllAsync.bind(tx),
        runAsync: tx.runAsync.bind(tx),
      });
      const detail = await repository.getReceiptDetail(input.receiptId);
      if (!detail || detail.receipt.storeId !== input.storeId)
        throw new Error("WASTE_RECEIPT_NOT_FOUND");
      if (detail.receipt.processingStatus === "PUBLISHED") return;
      const receipt = detail.receipt;
      if (
        receipt.processingStatus !== "TO_VALIDATE" ||
        !receipt.confirmedWasteDate ||
        !receipt.sourceDocumentId
      )
        throw new Error("WASTE_RECEIPT_NOT_READY");
      const source = await tx.getFirstAsync<{
        original_filename: string;
        checksum: string;
        remote_upload_status: string;
        created_at: string;
      }>(
        "SELECT * FROM source_documents WHERE id = ? AND store_id = ?",
        receipt.sourceDocumentId,
        input.storeId,
      );
      if (!source || source.remote_upload_status !== "CONFIRMED")
        throw new Error("WASTE_RECEIPT_SOURCE_PENDING");
      const lines = detail.lines.map((d) => ({
        ...d.line,
        validationStatus:
          d.line.validationStatus === "EXCLUDED"
            ? ("EXCLUDED" as const)
            : ("VALID" as const),
      }));
      const observations: WasteObservation[] = [];
      for (const draft of detail.lines) {
        const line = draft.line;
        if (line.validationStatus === "EXCLUDED") continue;
        const product = await tx.getFirstAsync<{
          nature: Product["nature"];
          sales_unit: Product["salesUnit"];
          status: string;
          deleted_at: string | null;
        }>(
          "SELECT * FROM products WHERE id = ? AND store_id = ?",
          line.matchedProductId ?? "",
          input.storeId,
        );
        const arithmetic = validateWasteReceiptArithmetic([
          {
            sourceLineIndex: line.sourceLineIndex,
            weight: line.weight ?? null,
            unitPrice: line.unitPrice ?? null,
            totalPrice: line.totalPrice ?? null,
          },
        ]).lines[0]!;
        if (
          !product ||
          product.deleted_at ||
          product.status !== "ACTIVE" ||
          product.nature === "UNKNOWN" ||
          line.matchStatus !== "MATCHED" ||
          line.productNature !== product.nature ||
          arithmetic.status === "MISMATCH" ||
          line.totalPrice == null
        )
          throw new Error("WASTE_RECEIPT_LINE_REVIEW_REQUIRED");
        const quantity =
          product.sales_unit === "KG"
            ? (line.weight ?? null)
            : line.quantityUnit === product.sales_unit
              ? (line.quantity ?? null)
              : null;
        if (
          quantity == null ||
          Number(quantity) <= 0 ||
          product.sales_unit === "UNKNOWN"
        )
          throw new Error("WASTE_RECEIPT_QUANTITY_REQUIRED");
        observations.push({
          id: line.id,
          storeId: input.storeId,
          productId: line.matchedProductId!,
          businessDate: receipt.confirmedWasteDate,
          productNature: product.nature,
          quantity,
          purchaseValueKnown: null,
          purchaseValueEstimated: null,
          salesValue: line.totalPrice,
          costQuality: "UNAVAILABLE",
          sourceType: "WASTE_RECEIPT",
          sourceDocumentId: receipt.sourceDocumentId,
          sourceRecordId: line.id,
          validationStatus: "VALIDATED",
          version: 1,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
          deletedAt: null,
          syncState: "PENDING",
          remoteVersion: null,
          dirty: true,
        });
      }
      const publication = wastePublicationSchema.parse({
        receipt: {
          ...receipt,
          localFileId: null,
          processingStatus: "PUBLISHED",
          syncState: "PENDING",
          dirty: true,
          version: receipt.version + 1,
          updatedAt: input.timestamp,
        },
        source: {
          id: receipt.sourceDocumentId,
          storeId: input.storeId,
          sourceType: "WASTE_RECEIPT",
          originalFilename: source.original_filename,
          checksum: source.checksum,
          localFileUri: null,
          localProcessingStatus: "PUBLISHED",
          remoteUploadStatus: "CONFIRMED",
          remoteProcessingStatus: "TO_VALIDATE",
          version: 1,
          createdAt: source.created_at,
          updatedAt: input.timestamp,
          deletedAt: null,
          syncState: "PENDING",
          remoteVersion: null,
          dirty: true,
        },
        lines,
        observations,
      });
      await persistObservations(tx, publication, null);
      await tx.runAsync(
        "UPDATE waste_receipts SET processing_status = 'PUBLISHED', sync_state = 'PENDING', dirty = 1, version = ?, updated_at = ? WHERE id = ?",
        publication.receipt.version,
        input.timestamp,
        receipt.id,
      );
      await tx.runAsync(
        "UPDATE waste_lines SET validation_status = CASE WHEN validation_status = 'EXCLUDED' THEN 'EXCLUDED' ELSE 'VALID' END, sync_state = 'PENDING', dirty = 1 WHERE receipt_id = ?",
        receipt.id,
      );
      await tx.runAsync(
        "UPDATE source_documents SET local_processing_status = 'PUBLISHED', sync_state = 'PENDING', dirty = 1, updated_at = ? WHERE id = ? AND store_id = ?",
        input.timestamp,
        receipt.sourceDocumentId,
        input.storeId,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: input.commandId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        commandType: "WASTE_RECEIPT_PUBLISH",
        entityType: "waste_receipt_publication",
        entityId: receipt.id,
        expectedRemoteVersion: null,
        payload: publication,
        createdAt: input.timestamp,
      });
      await enqueueAnalyticsRecomputationJob(tx, {
        jobId: input.analyticsJobId,
        storeId: input.storeId,
        scopes: observations.map((o) => ({
          productId: o.productId,
          businessDate: o.businessDate,
        })),
        sourceDocumentId: receipt.sourceDocumentId,
        createdAt: input.timestamp,
      });
      count = observations.length;
    });
    return { publishedCount: count };
  }
}

async function persistObservations(
  tx: OutboxDatabase,
  publication: WastePublication,
  remoteVersion: number | null,
) {
  for (const line of publication.lines) {
    await tx.runAsync(
      `INSERT INTO source_records (id, store_id, source_document_id, source_index, raw_payload_json, normalized_payload_json, status, error_codes_json, warning_codes_json, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'VALIDATED', '[]', '[]', 1, ?, ?, NULL) ON CONFLICT(id) DO NOTHING`,
      line.id,
      line.storeId,
      publication.source.id,
      line.sourceLineIndex,
      JSON.stringify(line),
      JSON.stringify(line),
      line.createdAt,
      line.updatedAt,
    );
  }
  for (const o of publication.observations) {
    await tx.runAsync(
      `INSERT INTO waste_observations (id, store_id, product_id, business_date, product_nature, quantity, purchase_value_known, purchase_value_estimated, sales_value, cost_quality, source_type, source_document_id, source_record_id, validation_status, version, created_at, updated_at, deleted_at, sync_state, remote_version, dirty) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'UNAVAILABLE', 'WASTE_RECEIPT', ?, ?, 'VALIDATED', 1, ?, ?, NULL, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET sync_state = excluded.sync_state, remote_version = excluded.remote_version, dirty = excluded.dirty`,
      o.id,
      o.storeId,
      o.productId,
      o.businessDate,
      o.productNature,
      o.quantity,
      o.salesValue,
      o.sourceDocumentId,
      o.sourceRecordId,
      o.createdAt,
      o.updatedAt,
      remoteVersion === null ? "PENDING" : "SYNCED",
      remoteVersion,
      remoteVersion === null ? 1 : 0,
    );
  }
}

export async function applyWastePublication(
  tx: OutboxDatabase,
  storeId: string,
  entity: unknown,
) {
  const snapshot = synchronizedWastePublicationSchema.parse(entity);
  const p = snapshot.publication;
  if (
    snapshot.storeId !== storeId ||
    snapshot.id !== p.receipt.id ||
    p.receipt.storeId !== storeId
  )
    throw new Error("WASTE_PUBLICATION_STORE_MISMATCH");
  const existing = await tx.getFirstAsync<{
    remote_version: number | null;
    processing_status: string;
  }>(
    "SELECT remote_version, processing_status FROM waste_receipts WHERE id = ? AND store_id = ?",
    snapshot.id,
    storeId,
  );
  if (
    existing?.remote_version &&
    existing.remote_version >= snapshot.remoteVersion
  )
    return;
  if (existing && existing.processing_status !== "PUBLISHED")
    throw new Error("WASTE_PUBLICATION_LOCAL_CONFLICT");
  if (!existing) {
    const source = await tx.getFirstAsync(
      "SELECT id FROM source_documents WHERE id = ? AND store_id = ?",
      p.source.id,
      storeId,
    );
    if (!source)
      await insertSourceDocument(tx, {
        ...p.source,
        syncState: "SYNCED",
        remoteVersion: snapshot.remoteVersion,
        dirty: false,
      } as LocalSourceDocument);
    await insertReceipt(tx, {
      ...p.receipt,
      syncState: "SYNCED",
      remoteVersion: snapshot.remoteVersion,
      dirty: false,
    });
    for (const line of p.lines)
      await insertLine(tx, {
        ...line,
        syncState: "SYNCED",
        remoteVersion: snapshot.remoteVersion,
        dirty: false,
      });
  }
  await persistObservations(tx, p, snapshot.remoteVersion);
  await tx.runAsync(
    "UPDATE source_documents SET local_processing_status = 'PUBLISHED', remote_processing_status = 'PUBLISHED', sync_state = 'SYNCED', dirty = 0 WHERE id = ? AND store_id = ?",
    p.source.id,
    storeId,
  );
  await tx.runAsync(
    "UPDATE waste_receipts SET sync_state = 'SYNCED', remote_version = ?, dirty = 0 WHERE id = ? AND store_id = ?",
    snapshot.remoteVersion,
    snapshot.id,
    storeId,
  );
  await tx.runAsync(
    "UPDATE waste_lines SET sync_state = 'SYNCED', remote_version = ?, dirty = 0 WHERE receipt_id = ? AND store_id = ?",
    snapshot.remoteVersion,
    snapshot.id,
    storeId,
  );
  await enqueueAnalyticsRecomputationJob(tx, {
    jobId: `waste-publication:${snapshot.id}:${snapshot.remoteVersion}`,
    storeId,
    scopes: p.observations.map((o) => ({
      productId: o.productId,
      businessDate: o.businessDate,
    })),
    createdAt: p.receipt.updatedAt,
  });
}
