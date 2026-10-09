export interface SQLiteMigrationDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

export interface LocalMigration {
  version: number;
  name: string;
  sql: string;
}

export const localMigrations: readonly LocalMigration[] = [
  {
    version: 1,
    name: "initialize-local-foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_inbox_state (
        store_id TEXT PRIMARY KEY NOT NULL,
        last_server_sequence INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        base_version INTEGER,
        local_sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_pending
        ON sync_outbox (store_id, status, local_sequence);

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        remote_payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conflicts_store_status
        ON sync_conflicts (store_id, status);

      CREATE TABLE IF NOT EXISTS local_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_jobs_status
        ON local_jobs (status, updated_at);

      CREATE TABLE IF NOT EXISTS local_files (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        source_document_id TEXT,
        local_uri TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        retention_status TEXT NOT NULL,
        upload_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_files_upload
        ON local_files (store_id, upload_status);
    `,
  },
  {
    version: 2,
    name: "align-outbox-with-sync-contract",
    sql: `
      ALTER TABLE sync_outbox RENAME TO sync_outbox_legacy;

      CREATE TABLE sync_outbox (
        command_id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        local_sequence INTEGER NOT NULL,
        command_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        expected_remote_version INTEGER,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error_code TEXT
      );

      INSERT INTO sync_outbox (
        command_id, store_id, device_id, local_sequence, command_type,
        entity_type, entity_id, expected_remote_version, payload_json,
        created_at, status, attempt_count, last_attempt_at, last_error_code
      )
      SELECT
        id, store_id, device_id, local_sequence, operation,
        entity_type, entity_id, base_version, payload_json,
        created_at, UPPER(status), attempt_count,
        CASE WHEN attempt_count > 0 THEN updated_at ELSE NULL END,
        last_error
      FROM sync_outbox_legacy;

      DROP TABLE sync_outbox_legacy;

      CREATE INDEX idx_outbox_pending
        ON sync_outbox (store_id, status, local_sequence);
      CREATE UNIQUE INDEX idx_outbox_device_sequence
        ON sync_outbox (device_id, local_sequence);

      INSERT INTO app_metadata (key, value, updated_at)
      SELECT
        'outbox_local_sequence',
        CAST(COALESCE(MAX(local_sequence), 0) AS TEXT),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM sync_outbox
      WHERE true
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
    `,
  },
  {
    version: 3,
    name: "add-sync-proof-entities",
    sql: `
      CREATE TABLE sync_test_entities (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        label TEXT NOT NULL,
        remote_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_sync_test_entities_store
        ON sync_test_entities (store_id, updated_at);
    `,
  },
  {
    version: 4,
    name: "align-sync-inbox-state-with-protocol",
    sql: `
      ALTER TABLE sync_inbox_state RENAME TO sync_inbox_state_legacy;

      CREATE TABLE sync_inbox_state (
        store_id TEXT PRIMARY KEY NOT NULL,
        cursor TEXT,
        last_successful_sync_at TEXT,
        protocol_version INTEGER NOT NULL,
        bootstrap_revision TEXT
      );

      INSERT INTO sync_inbox_state (
        store_id, cursor, last_successful_sync_at, protocol_version,
        bootstrap_revision
      )
      SELECT store_id, NULL, last_sync_at, 1, NULL
      FROM sync_inbox_state_legacy;

      DROP TABLE sync_inbox_state_legacy;
    `,
  },
  {
    version: 5,
    name: "align-sync-conflicts-with-canonical-contract",
    sql: `
      ALTER TABLE sync_conflicts RENAME TO sync_conflicts_legacy;

      CREATE TABLE sync_conflicts (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        command_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        remote_payload_json TEXT NOT NULL,
        local_expected_version INTEGER,
        remote_version INTEGER,
        conflict_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      INSERT INTO sync_conflicts (
        id, store_id, command_id, entity_type, entity_id,
        local_payload_json, remote_payload_json, local_expected_version,
        remote_version, conflict_type, status, created_at, resolved_at
      )
      SELECT
        id, store_id, NULL, entity_type, entity_id,
        local_payload_json, remote_payload_json, NULL,
        NULL, 'LEGACY_CONFLICT', UPPER(status), detected_at, resolved_at
      FROM sync_conflicts_legacy;

      DROP TABLE sync_conflicts_legacy;

      CREATE INDEX idx_conflicts_store_status
        ON sync_conflicts (store_id, status);
      CREATE UNIQUE INDEX idx_conflicts_command
        ON sync_conflicts (command_id)
        WHERE command_id IS NOT NULL;
    `,
  },
  {
    version: 6,
    name: "add-product-master",
    sql: `
      CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        label TEXT NOT NULL,
        category TEXT NOT NULL,
        nature TEXT NOT NULL,
        sales_unit TEXT NOT NULL,
        packaging_quantity TEXT,
        packaging_unit TEXT,
        packaging_source_label TEXT,
        family_id TEXT,
        subfamily_id TEXT,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'SYNCED',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_products_store_status
        ON products (store_id, status);
      CREATE INDEX idx_products_store_label
        ON products (store_id, label);

      CREATE TABLE product_identifiers (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'SYNCED',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_product_identifiers_lookup
        ON product_identifiers (store_id, type, value);
      CREATE INDEX idx_product_identifiers_product
        ON product_identifiers (store_id, product_id);

      CREATE TABLE product_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'SYNCED',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_product_aliases_lookup
        ON product_aliases (store_id, normalized_alias);
      CREATE INDEX idx_product_aliases_product
        ON product_aliases (store_id, product_id);
    `,
  },
  {
    version: 7,
    name: "add-local-source-documents",
    sql: `
      CREATE TABLE source_documents (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        original_filename TEXT,
        local_file_uri TEXT,
        checksum TEXT,
        source_generated_at TEXT,
        business_period_start TEXT,
        business_period_end TEXT,
        local_processing_status TEXT NOT NULL,
        remote_upload_status TEXT NOT NULL,
        remote_processing_status TEXT,
        parser_version TEXT,
        extraction_model_version TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_source_documents_store_status
        ON source_documents (store_id, local_processing_status);
      CREATE INDEX idx_source_documents_checksum
        ON source_documents (store_id, source_type, checksum);

      CREATE TABLE source_records (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_index INTEGER,
        source_page INTEGER,
        raw_payload_json TEXT NOT NULL,
        normalized_payload_json TEXT,
        status TEXT NOT NULL,
        error_codes_json TEXT NOT NULL,
        warning_codes_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
          ON DELETE RESTRICT
      );
      CREATE INDEX idx_source_records_document
        ON source_records (store_id, source_document_id, source_index);
      CREATE INDEX idx_source_records_status
        ON source_records (store_id, status);

      CREATE INDEX idx_local_files_source_document
        ON local_files (source_document_id);
    `,
  },
  {
    version: 8,
    name: "add-local-observations",
    sql: `
      CREATE TABLE sales_observations (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        quantity TEXT NOT NULL,
        purchase_value TEXT,
        rce_value TEXT,
        sales_value TEXT,
        vat_value TEXT,
        margin_value TEXT,
        margin_rate TEXT,
        source_document_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'SYNCED',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_sales_date_product
        ON sales_observations (store_id, business_date, product_id);
      CREATE INDEX idx_sales_product_date
        ON sales_observations (store_id, product_id, business_date);
      CREATE UNIQUE INDEX idx_sales_source_record
        ON sales_observations (store_id, source_record_id);

      CREATE TABLE waste_observations (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        product_nature TEXT NOT NULL,
        quantity TEXT,
        purchase_value_known TEXT,
        purchase_value_estimated TEXT,
        sales_value TEXT,
        cost_quality TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_document_id TEXT,
        source_record_id TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'SYNCED',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_waste_date_product
        ON waste_observations (store_id, business_date, product_id);
      CREATE INDEX idx_waste_product_date
        ON waste_observations (store_id, product_id, business_date);
      CREATE UNIQUE INDEX idx_waste_source_record
        ON waste_observations (store_id, source_record_id);
    `,
  },
  {
    version: 9,
    name: "add-import-reconciliation-audit",
    sql: `
      CREATE TABLE import_reconciliations (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        incoming_checksum TEXT NOT NULL,
        incoming_filename TEXT,
        business_period_start TEXT NOT NULL,
        business_period_end TEXT NOT NULL,
        prior_source_document_ids_json TEXT NOT NULL,
        classification_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        new_source_document_id TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT NOT NULL,
        FOREIGN KEY (new_source_document_id) REFERENCES source_documents(id)
          ON DELETE RESTRICT
      );
      CREATE INDEX idx_import_reconciliations_store_period
        ON import_reconciliations (
          store_id, source_type, business_period_start, business_period_end
        );
      CREATE INDEX idx_import_reconciliations_checksum
        ON import_reconciliations (store_id, source_type, incoming_checksum);
    `,
  },
  {
    version: 10,
    name: "add-import-verification-conflicts",
    sql: `
      CREATE TABLE import_verification_conflicts (
        source_document_id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        local_fingerprint TEXT NOT NULL,
        remote_fingerprint TEXT,
        difference_summary_json TEXT,
        status TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        acknowledged_at TEXT,
        FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
          ON DELETE RESTRICT
      );
      CREATE INDEX idx_import_verification_conflicts_store_status
        ON import_verification_conflicts (store_id, status, detected_at);
    `,
  },
  {
    version: 11,
    name: "add-local-analytics-read-models",
    sql: `
      CREATE TABLE product_daily_performance (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        origin TEXT NOT NULL,
        formula_version TEXT NOT NULL,
        input_revision TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX idx_product_daily_unique
        ON product_daily_performance (store_id, product_id, business_date);
      CREATE INDEX idx_product_daily_store_date
        ON product_daily_performance (store_id, business_date);

      CREATE TABLE department_daily_performance (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        origin TEXT NOT NULL,
        formula_version TEXT NOT NULL,
        input_revision TEXT NOT NULL,
        computed_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_department_daily_unique
        ON department_daily_performance (store_id, business_date);
    `,
  },
  {
    version: 12,
    name: "add-offline-waste-receipts",
    sql: `
      CREATE TABLE waste_receipts (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        source_document_id TEXT,
        local_file_id TEXT,
        capture_date TEXT,
        detected_receipt_date TEXT,
        confirmed_waste_date TEXT,
        processing_status TEXT NOT NULL,
        ai_status TEXT NOT NULL,
        duplicate_status TEXT NOT NULL,
        note TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
          ON DELETE RESTRICT,
        FOREIGN KEY (local_file_id) REFERENCES local_files(id)
          ON DELETE RESTRICT
      );
      CREATE INDEX idx_waste_receipts_store_status
        ON waste_receipts (store_id, processing_status, capture_date);
      CREATE INDEX idx_waste_receipts_local_file
        ON waste_receipts (local_file_id);

      CREATE TABLE waste_lines (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        source_line_index INTEGER NOT NULL,
        raw_label TEXT NOT NULL,
        quantity TEXT,
        weight TEXT,
        quantity_unit TEXT,
        unit_price TEXT,
        total_price TEXT,
        matched_product_id TEXT,
        match_status TEXT NOT NULL,
        match_confidence REAL,
        product_nature TEXT NOT NULL,
        extraction_confidence_json TEXT,
        source_region_json TEXT,
        validation_status TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (receipt_id) REFERENCES waste_receipts(id)
          ON DELETE RESTRICT,
        FOREIGN KEY (matched_product_id) REFERENCES products(id)
          ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX idx_waste_lines_receipt_index
        ON waste_lines (receipt_id, source_line_index);
      CREATE INDEX idx_waste_lines_store_match
        ON waste_lines (store_id, match_status);
    `,
  },
  {
    version: 13,
    name: "add-waste-receipt-validation-evidence",
    sql: `
      ALTER TABLE waste_lines ADD COLUMN arithmetic_status TEXT NOT NULL DEFAULT 'NOT_CHECKED';
      ALTER TABLE waste_lines ADD COLUMN arithmetic_expected_total TEXT;
      ALTER TABLE waste_lines ADD COLUMN arithmetic_difference TEXT;
      ALTER TABLE waste_lines ADD COLUMN arithmetic_warning_code TEXT;
      ALTER TABLE waste_lines ADD COLUMN match_state TEXT NOT NULL DEFAULT 'NO_MATCH';
      ALTER TABLE waste_lines ADD COLUMN matched_product_label TEXT;
      ALTER TABLE waste_lines ADD COLUMN match_candidates_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 14,
    name: "add-waste-receipt-duplicate-evidence",
    sql: `
      ALTER TABLE waste_receipts ADD COLUMN duplicate_candidate_source_document_id TEXT;
      ALTER TABLE waste_receipts ADD COLUMN duplicate_reason TEXT;
      CREATE INDEX idx_waste_receipts_duplicate_candidate
        ON waste_receipts (duplicate_candidate_source_document_id);
    `,
  },
  {
    version: 15,
    name: "add-waste-receipt-cashier-metadata",
    sql: `
      ALTER TABLE waste_receipts ADD COLUMN detected_cashier_number TEXT;
      ALTER TABLE waste_receipts ADD COLUMN confirmed_cashier_number TEXT;
      ALTER TABLE waste_receipts ADD COLUMN cashier_number_confirmed_at TEXT;
    `,
  },
  {
    version: 16,
    name: "add-commercial-extraction-review",
    sql: `CREATE TABLE commercial_review_pages (id TEXT PRIMARY KEY NOT NULL, store_id TEXT NOT NULL, source_document_id TEXT NOT NULL, page_number INTEGER NOT NULL, payload_json TEXT NOT NULL, remote_version INTEGER NOT NULL);
    CREATE INDEX idx_commercial_review_sources ON commercial_review_pages(store_id,source_document_id,page_number);
    CREATE TABLE commercial_review_decisions (id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,page_id TEXT NOT NULL,source_block_index INTEGER NOT NULL,payload_json TEXT NOT NULL,remote_version INTEGER,sync_state TEXT NOT NULL);
    CREATE INDEX idx_commercial_review_decisions ON commercial_review_decisions(store_id,page_id,source_block_index);`,
  },
  {
    version: 17,
    name: "add-commercial-visual-readings",
    sql: `CREATE TABLE commercial_visual_readings(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,source_document_id TEXT NOT NULL,page_number INTEGER NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX idx_commercial_visual_sources ON commercial_visual_readings(store_id,source_document_id,page_number);`,
  },
  {
    version: 18,
    name: "commercial_offer_choices",
    sql: `
    CREATE TABLE commercial_offer_choices (
      id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,source_document_id TEXT NOT NULL,
      reading_id TEXT NOT NULL,operation_index INTEGER NOT NULL,item_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,
      sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,
      UNIQUE(store_id,reading_id,operation_index,item_index)
    );
    CREATE INDEX commercial_choices_store ON commercial_offer_choices(store_id,source_document_id);
    CREATE TABLE commercial_choice_history (
      action_id TEXT PRIMARY KEY NOT NULL,choice_id TEXT NOT NULL,store_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL
    );
  `,
  },
  {
    version: 19,
    name: "commercial_week_preparations",
    sql: `CREATE TABLE commercial_week_preparations(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,week_start TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,UNIQUE(store_id,week_start)); CREATE TABLE commercial_preparation_history(action_id TEXT PRIMARY KEY NOT NULL,preparation_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 20,
    name: "commercial_version_decisions",
    sql: `CREATE TABLE commercial_version_decisions(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,pair_key TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,UNIQUE(store_id,pair_key)); CREATE TABLE commercial_version_decision_history(action_id TEXT PRIMARY KEY NOT NULL,decision_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 21,
    name: "commercial_validated_offers",
    sql: `CREATE TABLE commercial_validated_offers(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,choice_id TEXT NOT NULL,choice_version INTEGER NOT NULL,payload_json TEXT NOT NULL,sync_state TEXT NOT NULL,UNIQUE(store_id,choice_id,choice_version)); CREATE TABLE commercial_offer_validation_history(action_id TEXT PRIMARY KEY NOT NULL,offer_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 22,
    name: "commercial_week_plans",
    sql: `CREATE TABLE commercial_week_plans(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,week_start TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,UNIQUE(store_id,week_start)); CREATE TABLE commercial_plan_history(action_id TEXT PRIMARY KEY NOT NULL,plan_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE commercial_plan_revisions(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,plan_id TEXT NOT NULL,plan_version INTEGER NOT NULL,payload_json TEXT NOT NULL,UNIQUE(store_id,plan_id,plan_version)); CREATE TABLE commercial_operations(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,plan_id TEXT NOT NULL,payload_json TEXT NOT NULL,sync_state TEXT NOT NULL); CREATE INDEX commercial_operations_plan ON commercial_operations(store_id,plan_id); CREATE TABLE offers(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,plan_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_json TEXT NOT NULL,sync_state TEXT NOT NULL); CREATE INDEX offers_plan ON offers(store_id,plan_id);`,
  },
  {
    version: 23,
    name: "commercial_execution_tasks",
    sql: `CREATE TABLE commercial_execution_tasks(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,plan_id TEXT NOT NULL,plan_revision_id TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1); CREATE INDEX commercial_execution_revision ON commercial_execution_tasks(store_id,plan_revision_id); CREATE TABLE commercial_execution_history(action_id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 24,
    name: "store_context_settings",
    sql: `CREATE TABLE store_context_settings(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1); CREATE TABLE store_context_history(action_id TEXT PRIMARY KEY NOT NULL,settings_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 25,
    name: "weekly_context_cache",
    sql: `CREATE TABLE weekly_context_cache(store_id TEXT NOT NULL,week_start TEXT NOT NULL,settings_fingerprint TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(store_id,week_start,settings_fingerprint));`,
  },
  {
    version: 26,
    name: "device_commercial_reminders",
    sql: `CREATE TABLE device_reminder_preferences(store_id TEXT PRIMARY KEY NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL); CREATE TABLE device_commercial_reminders(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,notification_id TEXT,UNIQUE(store_id,operation_id)); CREATE TABLE device_reminder_history(action_id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 27,
    name: "need_units",
    sql: `CREATE TABLE need_units(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,code TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1); CREATE UNIQUE INDEX need_unit_store_code ON need_units(store_id,code) WHERE dirty=0; CREATE TABLE need_unit_history(action_id TEXT PRIMARY KEY NOT NULL,need_unit_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
  {
    version: 28,
    name: "need_memberships",
    sql: `CREATE TABLE need_memberships(id TEXT PRIMARY KEY NOT NULL,store_id TEXT NOT NULL,product_id TEXT NOT NULL,need_unit_id TEXT NOT NULL,payload_json TEXT NOT NULL,remote_payload_json TEXT,remote_version INTEGER,sync_state TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,UNIQUE(store_id,product_id,need_unit_id)); CREATE TABLE need_membership_history(action_id TEXT PRIMARY KEY NOT NULL,membership_id TEXT NOT NULL,store_id TEXT NOT NULL,payload_json TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);`,
  },
];

function validateMigrations(migrations: readonly LocalMigration[]) {
  const names = new Set<string>();

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Local migration versions must be contiguous: expected ${expectedVersion}, received ${migration.version}.`,
      );
    }
    if (!migration.name.trim() || names.has(migration.name)) {
      throw new Error(
        `Local migration name must be non-empty and unique: ${migration.name}.`,
      );
    }
    names.add(migration.name);
  });
}

export async function getLocalSchemaVersion(database: SQLiteMigrationDatabase) {
  const row = await database.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  return Number(row?.user_version ?? 0);
}

export async function runLocalMigrations(
  database: SQLiteMigrationDatabase,
  migrations: readonly LocalMigration[] = localMigrations,
) {
  validateMigrations(migrations);
  await database.execAsync("PRAGMA foreign_keys = ON;");
  await database.execAsync("PRAGMA journal_mode = WAL;");

  let currentVersion = await getLocalSchemaVersion(database);
  const supportedVersion = migrations.length;

  if (currentVersion > supportedVersion) {
    throw new Error(
      `Local database version ${currentVersion} is newer than supported version ${supportedVersion}.`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    await database.execAsync("BEGIN IMMEDIATE;");
    try {
      await database.execAsync(migration.sql);
      await database.execAsync(`PRAGMA user_version = ${migration.version};`);
      await database.execAsync(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES (
          'schema_version',
          '${migration.version}',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `);
      await database.execAsync("COMMIT;");
      currentVersion = migration.version;
    } catch (error) {
      await database.execAsync("ROLLBACK;");
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Local migration ${migration.version} (${migration.name}) failed: ${reason}`,
        { cause: error },
      );
    }
  }

  return currentVersion;
}
