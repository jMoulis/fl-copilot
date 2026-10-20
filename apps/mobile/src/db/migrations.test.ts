import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getOrCreateDeviceId } from "./device-identity";
import {
  getLocalSchemaVersion,
  localMigrations,
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "./migrations";

class NodeSQLiteAdapter implements SQLiteMigrationDatabase {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async runAsync(sql: string, ...params: (string | number | null)[]) {
    return this.database.prepare(sql).run(...params);
  }
}

const temporaryDirectories: string[] = [];

function openTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-sqlite-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "local.db");
  const database = new DatabaseSync(path);
  return { adapter: new NodeSQLiteAdapter(database), database, path };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local SQLite migrations", () => {
  it("upgrades existing v14 receipts without losing their date or pending work", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter, localMigrations.slice(0, 14));
    database.exec(`INSERT INTO waste_receipts (id, store_id, confirmed_waste_date, processing_status, ai_status, duplicate_status, version, created_at, updated_at, sync_state, dirty) VALUES ('legacy-receipt', 'legacy-store', '2026-09-23', 'CAPTURED', 'PENDING', 'NOT_DUPLICATE', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'LOCAL_ONLY', 1);
      INSERT INTO local_jobs (id, type, payload_json, status, created_at, updated_at) VALUES ('legacy-job', 'SOURCE_UPLOAD_AND_REGISTER', '{}', 'PENDING', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');`);
    await runLocalMigrations(adapter);
    expect(
      database
        .prepare(
          "SELECT confirmed_waste_date, detected_cashier_number, confirmed_cashier_number FROM waste_receipts WHERE id = 'legacy-receipt'",
        )
        .get(),
    ).toEqual({
      confirmed_waste_date: "2026-09-23",
      detected_cashier_number: null,
      confirmed_cashier_number: null,
    });
    expect(
      database
        .prepare("SELECT status FROM local_jobs WHERE id = 'legacy-job'")
        .get(),
    ).toEqual({ status: "PENDING" });
    database.close();
  });

  it("creates the foundation schema and exposes its version", async () => {
    const { adapter, database } = openTemporaryDatabase();

    await expect(runLocalMigrations(adapter)).resolves.toBe(
      localMigrations.length,
    );

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "action_executions",
      "app_metadata",
      "commercial_choice_history",
      "commercial_execution_history",
      "commercial_execution_tasks",
      "commercial_offer_choices",
      "commercial_offer_validation_history",
      "commercial_operations",
      "commercial_plan_history",
      "commercial_plan_revisions",
      "commercial_preparation_history",
      "commercial_processing_cache",
      "commercial_review_decisions",
      "commercial_review_pages",
      "commercial_validated_offers",
      "commercial_version_decision_history",
      "commercial_version_decisions",
      "commercial_visual_readings",
      "commercial_week_plans",
      "commercial_week_preparations",
      "copilot_conversation_history",
      "copilot_conversations",
      "copilot_decisions",
      "copilot_drafts",
      "copilot_execution_links",
      "copilot_forms",
      "copilot_knowledge",
      "copilot_layout_illustration_files",
      "copilot_layout_illustrations",
      "copilot_messages",
      "copilot_pending_turns",
      "copilot_priority_snapshots",
      "copilot_tool_results",
      "department_daily_performance",
      "device_commercial_reminders",
      "device_reminder_history",
      "device_reminder_preferences",
      "email_intake_bindings",
      "email_intake_decisions",
      "email_intake_receipts",
      "email_original_manifests",
      "email_source_handoffs",
      "import_reconciliations",
      "import_verification_conflicts",
      "local_files",
      "local_jobs",
      "mercalys_intake_archives",
      "mercalys_intake_batches",
      "mercalys_intake_items",
      "mercalys_publication_sync",
      "need_membership_history",
      "need_memberships",
      "need_unit_history",
      "need_units",
      "offers",
      "product_aliases",
      "product_daily_performance",
      "product_identifiers",
      "product_master_conflict_history",
      "product_master_remote_snapshots",
      "product_substitution_history",
      "product_substitutions",
      "product_visual_links",
      "products",
      "sales_observations",
      "source_documents",
      "source_original_manifests",
      "source_original_restorations",
      "source_records",
      "store_context_history",
      "store_context_settings",
      "store_layout_operations",
      "store_layout_revisions",
      "store_layouts",
      "store_product_event_history",
      "store_product_events",
      "substitution_evidence",
      "substitution_evidence_states",
      "substitution_score_history",
      "sync_conflicts",
      "sync_inbox_state",
      "sync_outbox",
      "sync_test_entities",
      "visual_asset_files",
      "visual_assets",
      "visual_conflict_history",
      "visual_identities",
      "waste_lines",
      "waste_observations",
      "waste_receipt_photo_groups",
      "waste_receipts",
      "weekly_context_cache",
    ]);
    expect(await getLocalSchemaVersion(adapter)).toBe(localMigrations.length);
    expect(
      database
        .prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'")
        .get(),
    ).toEqual({ value: String(localMigrations.length) });
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });

    database.close();
  });

  it("preserves data when the database is reopened and migrations rerun", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-sqlite-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "local.db");
    const firstDatabase = new DatabaseSync(path);
    const firstAdapter = new NodeSQLiteAdapter(firstDatabase);

    await runLocalMigrations(firstAdapter);
    firstDatabase
      .prepare(
        `
          INSERT INTO local_jobs (
            id, type, payload_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "job-persistence",
        "sync",
        "{}",
        "pending",
        "2026-09-16T10:00:00.000Z",
        "2026-09-16T10:00:00.000Z",
      );
    firstDatabase.close();

    const reopenedDatabase = new DatabaseSync(path);
    const reopenedAdapter = new NodeSQLiteAdapter(reopenedDatabase);
    await expect(runLocalMigrations(reopenedAdapter)).resolves.toBe(
      localMigrations.length,
    );
    expect(
      reopenedDatabase
        .prepare("SELECT id, status FROM local_jobs WHERE id = ?")
        .get("job-persistence"),
    ).toEqual({ id: "job-persistence", status: "pending" });

    reopenedDatabase.close();
  });

  it("adds source tables without losing pre-existing local files", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter, localMigrations.slice(0, 6));
    database
      .prepare(
        `
          INSERT INTO local_files (
            id, store_id, source_document_id, local_uri, mime_type,
            size_bytes, checksum, retention_status, upload_status,
            created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "file-before-m2-t04",
        "store-1",
        "file:///documents/source.xlsx",
        "application/octet-stream",
        128,
        "sha256:before-migration",
        "RETAINED",
        "LOCAL_ONLY",
        "2026-09-27T10:00:00.000Z",
        "2026-09-27T10:00:00.000Z",
      );

    await expect(runLocalMigrations(adapter)).resolves.toBe(
      localMigrations.length,
    );
    expect(
      database
        .prepare("SELECT id, checksum FROM local_files WHERE id = ?")
        .get("file-before-m2-t04"),
    ).toEqual({
      id: "file-before-m2-t04",
      checksum: "sha256:before-migration",
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('source_documents', 'source_records')",
        )
        .get(),
    ).toEqual({ count: 2 });

    database.close();
  });

  it("migrates legacy Outbox rows to the canonical command contract", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter, localMigrations.slice(0, 1));
    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id, store_id, device_id, entity_type, entity_id, operation,
            payload_json, base_version, local_sequence, status, attempt_count,
            last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "legacy-command",
        "store-1",
        "device-1",
        "product",
        "product-1",
        "PRODUCT_UPSERT",
        '{"name":"Tomate"}',
        4,
        7,
        "pending",
        1,
        "NETWORK_ERROR",
        "2026-09-16T10:00:00.000Z",
        "2026-09-16T10:01:00.000Z",
      );
    database
      .prepare(
        `
          INSERT INTO sync_inbox_state (
            store_id, last_server_sequence, last_sync_at, updated_at
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        "store-1",
        12,
        "2026-09-16T10:02:00.000Z",
        "2026-09-16T10:02:00.000Z",
      );

    await expect(runLocalMigrations(adapter)).resolves.toBe(
      localMigrations.length,
    );
    expect(
      database
        .prepare(
          `
            SELECT command_id, command_type, expected_remote_version,
                   local_sequence, status, attempt_count, last_attempt_at,
                   last_error_code
            FROM sync_outbox
          `,
        )
        .get(),
    ).toEqual({
      command_id: "legacy-command",
      command_type: "PRODUCT_UPSERT",
      expected_remote_version: 4,
      local_sequence: 7,
      status: "PENDING",
      attempt_count: 1,
      last_attempt_at: "2026-09-16T10:01:00.000Z",
      last_error_code: "NETWORK_ERROR",
    });
    expect(
      database
        .prepare("SELECT value FROM app_metadata WHERE key = ?")
        .get("outbox_local_sequence"),
    ).toEqual({ value: "7" });
    expect(
      database
        .prepare(
          `
            SELECT cursor, last_successful_sync_at, protocol_version,
                   bootstrap_revision
            FROM sync_inbox_state
            WHERE store_id = ?
          `,
        )
        .get("store-1"),
    ).toEqual({
      cursor: null,
      last_successful_sync_at: "2026-09-16T10:02:00.000Z",
      protocol_version: 1,
      bootstrap_revision: null,
    });

    database.close();
  });

  it("preserves legacy conflict payloads in the canonical conflict table", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter, localMigrations.slice(0, 1));
    database
      .prepare(
        `
          INSERT INTO sync_conflicts (
            id, store_id, entity_type, entity_id, local_payload_json,
            remote_payload_json, status, detected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conflict-1",
        "store-1",
        "product",
        "product-1",
        '{"name":"Tomate locale"}',
        '{"name":"Tomate distante"}',
        "open",
        "2026-09-16T10:03:00.000Z",
      );

    await expect(runLocalMigrations(adapter)).resolves.toBe(
      localMigrations.length,
    );
    expect(
      database
        .prepare(
          `
            SELECT command_id, local_payload_json, remote_payload_json,
                   conflict_type, status, created_at
            FROM sync_conflicts WHERE id = ?
          `,
        )
        .get("conflict-1"),
    ).toEqual({
      command_id: null,
      local_payload_json: '{"name":"Tomate locale"}',
      remote_payload_json: '{"name":"Tomate distante"}',
      conflict_type: "LEGACY_CONFLICT",
      status: "OPEN",
      created_at: "2026-09-16T10:03:00.000Z",
    });

    database.close();
  });

  it("rolls back a failed migration without losing pending outbox work", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            command_id, store_id, device_id, local_sequence, command_type,
            entity_type, entity_id, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "outbox-1",
        "store-1",
        "device-1",
        1,
        "PRODUCT_UPSERT",
        "product",
        "product-1",
        "{}",
        "PENDING",
        "2026-09-16T10:00:00.000Z",
      );

    await expect(
      runLocalMigrations(adapter, [
        ...localMigrations,
        {
          version: localMigrations.length + 1,
          name: "invalid-migration",
          sql: "CREATE TABLE broken (",
        },
      ]),
    ).rejects.toThrow(
      `Local migration ${localMigrations.length + 1} (invalid-migration) failed`,
    );

    expect(await getLocalSchemaVersion(adapter)).toBe(localMigrations.length);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
    ).toEqual({ count: 1 });

    database.close();
  });
});

describe("device identity", () => {
  it("survives reopen and differs between clean databases", async () => {
    const first = openTemporaryDatabase();
    await runLocalMigrations(first.adapter);
    const firstId = await getOrCreateDeviceId(
      first.adapter,
      () => "11111111-1111-4111-8111-111111111111",
    );
    first.database.close();

    const reopened = new DatabaseSync(first.path);
    const reopenedAdapter = new NodeSQLiteAdapter(reopened);
    await runLocalMigrations(reopenedAdapter);
    const reopenedId = await getOrCreateDeviceId(reopenedAdapter, () => {
      throw new Error("A restart must not generate a new device ID.");
    });

    const clean = openTemporaryDatabase();
    await runLocalMigrations(clean.adapter);
    const cleanId = await getOrCreateDeviceId(
      clean.adapter,
      () => "22222222-2222-4222-8222-222222222222",
    );

    expect(reopenedId).toBe(firstId);
    expect(cleanId).not.toBe(firstId);

    reopened.close();
    clean.database.close();
  });
});

it("upgrades the v41 catalogue without changing local edits or pending conflicts", async () => {
  const { adapter, database } = openTemporaryDatabase();
  try {
    await runLocalMigrations(adapter, localMigrations.slice(0, 41));
    database.exec(`INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty,remote_version) VALUES('legacy-product','legacy-store','Figues','FRUIT','BULK','KG','ACTIVE',2,'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','CONFLICT',1,1);
INSERT INTO sync_outbox(command_id,store_id,device_id,local_sequence,command_type,entity_type,entity_id,expected_remote_version,payload_json,created_at,status,attempt_count) VALUES('legacy-command','legacy-store','legacy-device',1,'PRODUCT_UPSERT','product','legacy-product',1,'{}','2026-10-02T00:00:00Z','CONFLICT',0);
INSERT INTO sync_conflicts(id,store_id,command_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at) VALUES('legacy-command','legacy-store','legacy-command','product','legacy-product','{}','{}',1,2,'SYNC_VERSION_CONFLICT','OPEN','2026-10-02T00:00:00Z');`);
    const tables = ["products", "sync_outbox", "sync_conflicts"],
      before = tables.map((t) => database.prepare(`SELECT * FROM ${t}`).all());
    await runLocalMigrations(adapter);
    expect(
      tables.map((t) => database.prepare(`SELECT * FROM ${t}`).all()),
    ).toEqual(before);
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM product_master_conflict_history")
        .get()!.n,
    ).toBe(0);
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM product_master_remote_snapshots")
        .get()!.n,
    ).toBe(0);
  } finally {
    database.close();
  }
});

it("upgrades v42 without changing missing originals, pending commands or upload attempts", async () => {
  const { adapter, database } = openTemporaryDatabase();
  try {
    await runLocalMigrations(adapter, localMigrations.slice(0, 42));
    database.exec(`INSERT INTO source_documents(id,store_id,source_type,original_filename,local_file_uri,checksum,local_processing_status,remote_upload_status,version,created_at,updated_at,sync_state,dirty) VALUES('source','store','MERCALYS_SALES','ventes.xlsx','file:///missing.xlsx','sha256:known','PUBLISHED','FAILED',1,'2026-10-18T12:00:00Z','2026-10-18T12:00:00Z','ERROR',1);
INSERT INTO local_files(id,store_id,source_document_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status,created_at,updated_at) VALUES('file','store','source','file:///missing.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'sha256:known','RETAINED','FAILED','2026-10-18T12:00:00Z','2026-10-18T12:00:00Z');
INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,last_error,created_at,updated_at) VALUES('upload','SOURCE_UPLOAD_AND_REGISTER','{}','FAILED',4,'SOURCE_UPLOAD_LOCAL_FILE_MISSING','2026-10-18T12:00:00Z','2026-10-18T12:00:00Z');
INSERT INTO sync_outbox(command_id,store_id,device_id,local_sequence,command_type,entity_type,entity_id,payload_json,created_at,status,attempt_count) VALUES('command','store','device',1,'MERCALYS_PUBLISH','mercalys_publication','source','{}','2026-10-18T12:00:00Z','PENDING',0);`);
    const tables = [
        "source_documents",
        "local_files",
        "local_jobs",
        "sync_outbox",
      ],
      before = tables.map((t) => database.prepare(`SELECT * FROM ${t}`).all());
    await runLocalMigrations(adapter);
    expect(
      tables.map((t) => database.prepare(`SELECT * FROM ${t}`).all()),
    ).toEqual(before);
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM source_original_restorations")
        .get()!.n,
    ).toBe(0);
    expect(await getLocalSchemaVersion(adapter)).toBe(localMigrations.length);
  } finally {
    database.close();
  }
});

it("adds the v50 visual cache without changing the v49 layout, catalogue or pending source work", async () => {
  const { adapter, database } = openTemporaryDatabase();
  try {
    await runLocalMigrations(adapter, localMigrations.slice(0, 49));
    database.exec(`INSERT INTO store_layouts(id,store_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES('plan','store','{"local":"kept"}','{"remote":"kept"}',2,'PENDING',1);
INSERT INTO store_layout_revisions(id,store_id,plan_version,payload_json,synced) VALUES('revision','store',3,'{"geometry":"kept"}',0);
INSERT INTO store_layout_operations(command_id,store_id,intent_json,payload_json) VALUES('layout-command','store','{"action":"kept"}','{"plan":"kept"}');
INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty) VALUES('product','store','Poire','FRUIT','BULK','KG','ACTIVE',2,'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','PENDING',1);
INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,last_error,created_at,updated_at) VALUES('source-job','SOURCE_UPLOAD_AND_REGISTER','{}','RETRY',2,'NETWORK_UNAVAILABLE','2026-10-18T12:00:00Z','2026-10-18T12:00:00Z');`);
    const tables = [
      "store_layouts",
      "store_layout_revisions",
      "store_layout_operations",
      "products",
      "local_jobs",
    ];
    const before = tables.map((table) =>
      database.prepare(`SELECT * FROM ${table}`).all(),
    );
    await runLocalMigrations(adapter);
    await runLocalMigrations(adapter);
    expect(
      tables.map((table) => database.prepare(`SELECT * FROM ${table}`).all()),
    ).toEqual(before);
    expect(
      database
        .prepare("PRAGMA table_info(visual_asset_files)")
        .all()
        .map((r) => r.name),
    ).toEqual([
      "asset_id",
      "store_id",
      "variant",
      "relative_path",
      "verified_hash",
      "size_bytes",
      "last_accessed_at",
      "pinned",
      "uploaded",
      "manifest_json",
    ]);
    expect(
      database.prepare("SELECT COUNT(*) n FROM visual_asset_files").get()!.n,
    ).toBe(0);
  } finally {
    database.close();
  }
});
it("upgrades illustration cache v58 without losing private recovery metadata or pending commands", async () => {
  const { adapter, database } = openTemporaryDatabase();
  try {
    await runLocalMigrations(adapter, localMigrations.slice(0, 58));
    database
      .prepare(
        "INSERT INTO copilot_layout_illustration_files(id,store_id,owner_id,preparation_id,created_at,manifest_json) VALUES('result','store','owner','preparation','2026-10-20T12:00:00Z','{\"preserved\":true}')",
      )
      .run();
    const before = database.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    await runLocalMigrations(adapter);
    expect(
      database.prepare("SELECT * FROM copilot_layout_illustration_files").get(),
    ).toEqual({
      id: "result",
      store_id: "store",
      owner_id: "owner",
      preparation_id: "preparation",
      created_at: "2026-10-20T12:00:00Z",
      manifest_json: '{"preserved":true}',
      last_accessed_at: "2026-10-20T12:00:00Z",
      offline_required: 0,
    });
    expect(
      database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
    ).toEqual(before);
  } finally {
    database.close();
  }
});
