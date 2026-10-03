import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncInboxState = sqliteTable("sync_inbox_state", {
  storeId: text("store_id").primaryKey(),
  cursor: text("cursor"),
  lastSuccessfulSyncAt: text("last_successful_sync_at"),
  protocolVersion: integer("protocol_version").notNull(),
  bootstrapRevision: text("bootstrap_revision"),
});

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    commandId: text("command_id").primaryKey(),
    storeId: text("store_id").notNull(),
    deviceId: text("device_id").notNull(),
    localSequence: integer("local_sequence").notNull(),
    commandType: text("command_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    expectedRemoteVersion: integer("expected_remote_version"),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    index("idx_outbox_pending").on(
      table.storeId,
      table.status,
      table.localSequence,
    ),
    uniqueIndex("idx_outbox_device_sequence").on(
      table.deviceId,
      table.localSequence,
    ),
  ],
);

export const syncTestEntities = sqliteTable(
  "sync_test_entities",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    label: text("label").notNull(),
    remoteVersion: integer("remote_version").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_sync_test_entities_store").on(table.storeId, table.updatedAt),
  ],
);

export const syncConflicts = sqliteTable(
  "sync_conflicts",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    commandId: text("command_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    localPayloadJson: text("local_payload_json").notNull(),
    remotePayloadJson: text("remote_payload_json").notNull(),
    localExpectedVersion: integer("local_expected_version"),
    remoteVersion: integer("remote_version"),
    conflictType: text("conflict_type").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_conflicts_store_status").on(table.storeId, table.status),
    uniqueIndex("idx_conflicts_command").on(table.commandId),
  ],
);

export const localJobs = sqliteTable(
  "local_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_local_jobs_status").on(table.status, table.updatedAt)],
);

export const localFiles = sqliteTable(
  "local_files",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    sourceDocumentId: text("source_document_id"),
    localUri: text("local_uri").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum").notNull(),
    retentionStatus: text("retention_status").notNull(),
    uploadStatus: text("upload_status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_local_files_upload").on(table.storeId, table.uploadStatus),
    index("idx_local_files_source_document").on(table.sourceDocumentId),
  ],
);

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    sourceType: text("source_type").notNull(),
    originalFilename: text("original_filename"),
    localFileUri: text("local_file_uri"),
    checksum: text("checksum"),
    sourceGeneratedAt: text("source_generated_at"),
    businessPeriodStart: text("business_period_start"),
    businessPeriodEnd: text("business_period_end"),
    localProcessingStatus: text("local_processing_status").notNull(),
    remoteUploadStatus: text("remote_upload_status").notNull(),
    remoteProcessingStatus: text("remote_processing_status"),
    parserVersion: text("parser_version"),
    extractionModelVersion: text("extraction_model_version"),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("LOCAL_ONLY"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(1),
  },
  (table) => [
    index("idx_source_documents_store_status").on(
      table.storeId,
      table.localProcessingStatus,
    ),
    index("idx_source_documents_checksum").on(
      table.storeId,
      table.sourceType,
      table.checksum,
    ),
  ],
);

export const sourceRecords = sqliteTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    sourceIndex: integer("source_index"),
    sourcePage: integer("source_page"),
    rawPayloadJson: text("raw_payload_json").notNull(),
    normalizedPayloadJson: text("normalized_payload_json"),
    status: text("status").notNull(),
    errorCodesJson: text("error_codes_json").notNull(),
    warningCodesJson: text("warning_codes_json").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_source_records_document").on(
      table.storeId,
      table.sourceDocumentId,
      table.sourceIndex,
    ),
    index("idx_source_records_status").on(table.storeId, table.status),
  ],
);

export const salesObservations = sqliteTable(
  "sales_observations",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    productId: text("product_id").notNull(),
    businessDate: text("business_date").notNull(),
    quantity: text("quantity").notNull(),
    purchaseValue: text("purchase_value"),
    rceValue: text("rce_value"),
    salesValue: text("sales_value"),
    vatValue: text("vat_value"),
    marginValue: text("margin_value"),
    marginRate: text("margin_rate"),
    sourceDocumentId: text("source_document_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    validationStatus: text("validation_status").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("SYNCED"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(0),
  },
  (table) => [
    index("idx_sales_date_product").on(
      table.storeId,
      table.businessDate,
      table.productId,
    ),
    index("idx_sales_product_date").on(
      table.storeId,
      table.productId,
      table.businessDate,
    ),
    uniqueIndex("idx_sales_source_record").on(
      table.storeId,
      table.sourceRecordId,
    ),
  ],
);

export const wasteObservations = sqliteTable(
  "waste_observations",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    productId: text("product_id").notNull(),
    businessDate: text("business_date").notNull(),
    productNature: text("product_nature").notNull(),
    quantity: text("quantity"),
    purchaseValueKnown: text("purchase_value_known"),
    purchaseValueEstimated: text("purchase_value_estimated"),
    salesValue: text("sales_value"),
    costQuality: text("cost_quality").notNull(),
    sourceType: text("source_type").notNull(),
    sourceDocumentId: text("source_document_id"),
    sourceRecordId: text("source_record_id").notNull(),
    validationStatus: text("validation_status").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("SYNCED"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(0),
  },
  (table) => [
    index("idx_waste_date_product").on(
      table.storeId,
      table.businessDate,
      table.productId,
    ),
    index("idx_waste_product_date").on(
      table.storeId,
      table.productId,
      table.businessDate,
    ),
    uniqueIndex("idx_waste_source_record").on(
      table.storeId,
      table.sourceRecordId,
    ),
  ],
);

export const importReconciliations = sqliteTable(
  "import_reconciliations",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    sourceType: text("source_type").notNull(),
    incomingChecksum: text("incoming_checksum").notNull(),
    incomingFilename: text("incoming_filename"),
    businessPeriodStart: text("business_period_start").notNull(),
    businessPeriodEnd: text("business_period_end").notNull(),
    priorSourceDocumentIdsJson: text(
      "prior_source_document_ids_json",
    ).notNull(),
    classificationJson: text("classification_json").notNull(),
    decision: text("decision").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    newSourceDocumentId: text("new_source_document_id"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at").notNull(),
  },
  (table) => [
    index("idx_import_reconciliations_store_period").on(
      table.storeId,
      table.sourceType,
      table.businessPeriodStart,
      table.businessPeriodEnd,
    ),
    index("idx_import_reconciliations_checksum").on(
      table.storeId,
      table.sourceType,
      table.incomingChecksum,
    ),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull(),
    nature: text("nature").notNull(),
    salesUnit: text("sales_unit").notNull(),
    packagingQuantity: text("packaging_quantity"),
    packagingUnit: text("packaging_unit"),
    packagingSourceLabel: text("packaging_source_label"),
    familyId: text("family_id"),
    subfamilyId: text("subfamily_id"),
    status: text("status").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("SYNCED"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(0),
  },
  (table) => [
    index("idx_products_store_status").on(table.storeId, table.status),
    index("idx_products_store_label").on(table.storeId, table.label),
  ],
);

export const productIdentifiers = sqliteTable(
  "product_identifiers",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    productId: text("product_id").notNull(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("SYNCED"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(0),
  },
  (table) => [
    index("idx_product_identifiers_lookup").on(
      table.storeId,
      table.type,
      table.value,
    ),
    index("idx_product_identifiers_product").on(table.storeId, table.productId),
  ],
);

export const productAliases = sqliteTable(
  "product_aliases",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    productId: text("product_id").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    confidence: real("confidence"),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    syncState: text("sync_state").notNull().default("SYNCED"),
    remoteVersion: integer("remote_version"),
    dirty: integer("dirty").notNull().default(0),
  },
  (table) => [
    index("idx_product_aliases_lookup").on(
      table.storeId,
      table.normalizedAlias,
    ),
    index("idx_product_aliases_product").on(table.storeId, table.productId),
  ],
);

export const localSchema = {
  appMetadata,
  syncInboxState,
  syncOutbox,
  syncTestEntities,
  syncConflicts,
  localJobs,
  localFiles,
  sourceDocuments,
  sourceRecords,
  salesObservations,
  wasteObservations,
  importReconciliations,
  products,
  productIdentifiers,
  productAliases,
};
