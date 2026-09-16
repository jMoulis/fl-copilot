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
  it("creates the foundation schema and exposes its version", async () => {
    const { adapter, database } = openTemporaryDatabase();

    await expect(runLocalMigrations(adapter)).resolves.toBe(1);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "app_metadata",
      "local_files",
      "local_jobs",
      "sync_conflicts",
      "sync_inbox_state",
      "sync_outbox",
    ]);
    expect(await getLocalSchemaVersion(adapter)).toBe(1);
    expect(
      database
        .prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'")
        .get(),
    ).toEqual({ value: "1" });
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
    await expect(runLocalMigrations(reopenedAdapter)).resolves.toBe(1);
    expect(
      reopenedDatabase
        .prepare("SELECT id, status FROM local_jobs WHERE id = ?")
        .get("job-persistence"),
    ).toEqual({ id: "job-persistence", status: "pending" });

    reopenedDatabase.close();
  });

  it("rolls back a failed migration without losing pending outbox work", async () => {
    const { adapter, database } = openTemporaryDatabase();
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id, store_id, device_id, entity_type, entity_id, operation,
            payload_json, local_sequence, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "outbox-1",
        "store-1",
        "device-1",
        "product",
        "product-1",
        "upsert",
        "{}",
        1,
        "pending",
        "2026-09-16T10:00:00.000Z",
        "2026-09-16T10:00:00.000Z",
      );

    await expect(
      runLocalMigrations(adapter, [
        ...localMigrations,
        { version: 2, name: "invalid-migration", sql: "CREATE TABLE broken (" },
      ]),
    ).rejects.toThrow("Local migration 2 (invalid-migration) failed");

    expect(await getLocalSchemaVersion(adapter)).toBe(1);
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
