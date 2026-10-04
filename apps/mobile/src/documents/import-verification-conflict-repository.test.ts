import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ImportVerificationConflictRepository } from "./import-verification-conflict-repository";

type SQLiteValue = string | number | null;

class NodeDatabase
  implements SQLiteMigrationDatabase, OutboxDatabase, AtomicMutationDatabase
{
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const temporaryDirectories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const sourceDocumentId = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ImportVerificationConflictRepository", () => {
  it("lists the import context and keeps local observations without replacing them", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-verification-"));
    temporaryDirectories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const createdAt = "2026-10-03T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO source_documents (
          id, store_id, source_type, original_filename, checksum,
          business_period_start, business_period_end,
          local_processing_status, remote_upload_status,
          remote_processing_status, version, created_at, updated_at,
          sync_state, dirty
        ) VALUES (?, ?, 'MERCALYS_SALES', 'ventes.xlsx', ?,
          '2026-09-26', '2026-09-26', 'PUBLISHED', 'CONFIRMED',
          'RECONCILING', 1, ?, ?, 'CONFLICT', 0)`,
      )
      .run(
        sourceDocumentId,
        storeId,
        `sha256:${"a".repeat(64)}`,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO source_records (
          id, store_id, source_document_id, source_index,
          raw_payload_json, status, error_codes_json, warning_codes_json,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, 1, '{}', 'PUBLISHED', '[]', '[]', 1, ?, ?)`,
      )
      .run(
        "33333333-3333-4333-8333-333333333333",
        storeId,
        sourceDocumentId,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO import_verification_conflicts (
          source_document_id, store_id, local_fingerprint,
          remote_fingerprint, difference_summary_json, status, detected_at
        ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(
        sourceDocumentId,
        storeId,
        `sha256:${"c".repeat(64)}`,
        `sha256:${"d".repeat(64)}`,
        JSON.stringify({ added: 1, removed: 0, modified: 1 }),
        createdAt,
      );

    const repository = new ImportVerificationConflictRepository(
      adapter,
      () => "2026-10-03T12:10:00.000Z",
    );

    await expect(repository.listOpen(storeId)).resolves.toEqual([
      expect.objectContaining({
        sourceDocumentId,
        filename: "ventes.xlsx",
        localRecordCount: 1,
        status: "OPEN",
        differenceSummary: { added: 1, removed: 0, modified: 1 },
      }),
    ]);
    await expect(
      repository.keepLocalTemporarily(sourceDocumentId, storeId),
    ).resolves.toEqual(
      expect.objectContaining({
        sourceDocumentId,
        status: "KEPT_LOCAL",
        acknowledgedAt: "2026-10-03T12:10:00.000Z",
      }),
    );
    expect(
      database
        .prepare(
          "SELECT remote_processing_status, sync_state FROM source_documents WHERE id = ?",
        )
        .get(sourceDocumentId),
    ).toEqual({
      remote_processing_status: "RECONCILING",
      sync_state: "SYNCED",
    });
    await expect(repository.listOpen(storeId)).resolves.toEqual([]);
    database.close();
  });
});
