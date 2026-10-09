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

    await expect(runLocalMigrations(adapter)).resolves.toBe(28);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
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
      "commercial_review_decisions",
      "commercial_review_pages",
      "commercial_validated_offers",
      "commercial_version_decision_history",
      "commercial_version_decisions",
      "commercial_visual_readings",
      "commercial_week_plans",
      "commercial_week_preparations",
      "department_daily_performance",
      "device_commercial_reminders",
      "device_reminder_history",
      "device_reminder_preferences",
      "import_reconciliations",
      "import_verification_conflicts",
      "local_files",
      "local_jobs",
      "need_membership_history",
      "need_memberships",
      "need_unit_history",
      "need_units",
      "offers",
      "product_aliases",
      "product_daily_performance",
      "product_identifiers",
      "products",
      "sales_observations",
      "source_documents",
      "source_records",
      "store_context_history",
      "store_context_settings",
      "sync_conflicts",
      "sync_inbox_state",
      "sync_outbox",
      "sync_test_entities",
      "waste_lines",
      "waste_observations",
      "waste_receipts",
      "weekly_context_cache",
    ]);
    expect(await getLocalSchemaVersion(adapter)).toBe(28);
    expect(
      database
        .prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'")
        .get(),
    ).toEqual({ value: "28" });
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
    await expect(runLocalMigrations(reopenedAdapter)).resolves.toBe(28);
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

    await expect(runLocalMigrations(adapter)).resolves.toBe(28);
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

    await expect(runLocalMigrations(adapter)).resolves.toBe(28);
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

    await expect(runLocalMigrations(adapter)).resolves.toBe(28);
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
          version: 29,
          name: "invalid-migration",
          sql: "CREATE TABLE broken (",
        },
      ]),
    ).rejects.toThrow("Local migration 29 (invalid-migration) failed");

    expect(await getLocalSchemaVersion(adapter)).toBe(28);
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
