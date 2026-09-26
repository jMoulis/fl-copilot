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
  products,
  productIdentifiers,
  productAliases,
};
