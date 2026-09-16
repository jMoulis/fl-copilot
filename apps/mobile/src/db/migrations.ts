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
