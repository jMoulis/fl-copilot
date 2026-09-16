import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncInboxState = sqliteTable("sync_inbox_state", {
  storeId: text("store_id").primaryKey(),
  lastServerSequence: integer("last_server_sequence").notNull().default(0),
  lastSyncAt: text("last_sync_at"),
  updatedAt: text("updated_at").notNull(),
});

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    deviceId: text("device_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    baseVersion: integer("base_version"),
    localSequence: integer("local_sequence").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_outbox_pending").on(
      table.storeId,
      table.status,
      table.localSequence,
    ),
  ],
);

export const syncConflicts = sqliteTable(
  "sync_conflicts",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    localPayloadJson: text("local_payload_json").notNull(),
    remotePayloadJson: text("remote_payload_json").notNull(),
    status: text("status").notNull(),
    detectedAt: text("detected_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_conflicts_store_status").on(table.storeId, table.status),
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

export const localSchema = {
  appMetadata,
  syncInboxState,
  syncOutbox,
  syncConflicts,
  localJobs,
  localFiles,
};
