import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncPullResponse } from "@fl-copilot/sync-contracts";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { applyPullPage } from "./apply-pull-page";
import type { OutboxDatabase } from "./outbox-repository";

type SQLiteValue = string | number | null;

class NodePullDatabase
  implements SQLiteMigrationDatabase, OutboxDatabase, AtomicMutationDatabase
{
  beforeCommit: (() => void) | undefined;

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
      this.beforeCommit?.();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const temporaryDirectories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-pull-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  return { adapter: new NodePullDatabase(database), database };
}

function page(remoteVersion: number, nextCursor: string): SyncPullResponse {
  return {
    changes: [
      {
        sequence: String(remoteVersion),
        entityType: "sync_test_entity",
        entityId,
        operation: "UPSERT",
        entityVersion: remoteVersion,
        entity: {
          id: entityId,
          storeId,
          label: `Version ${remoteVersion}`,
          remoteVersion,
          createdAt: "2026-09-26T08:00:00.000Z",
          updatedAt: `2026-09-26T08:0${remoteVersion}:00.000Z`,
        },
        changedAt: `2026-09-26T08:0${remoteVersion}:00.000Z`,
      },
    ],
    nextCursor,
    hasMore: false,
    serverTime: `2026-09-26T08:1${remoteVersion}:00.000Z`,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("atomic pull page application", () => {
  it("commits entities and the opaque cursor in one transaction", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);

    await applyPullPage(adapter, storeId, page(1, "opaque-cursor-1"));

    expect(
      database
        .prepare(
          "SELECT label, remote_version FROM sync_test_entities WHERE id = ?",
        )
        .get(entityId),
    ).toEqual({ label: "Version 1", remote_version: 1 });
    expect(
      database
        .prepare(
          `
            SELECT cursor, last_successful_sync_at, protocol_version
            FROM sync_inbox_state WHERE store_id = ?
          `,
        )
        .get(storeId),
    ).toEqual({
      cursor: "opaque-cursor-1",
      last_successful_sync_at: "2026-09-26T08:11:00.000Z",
      protocol_version: 1,
    });

    database.close();
  });

  it("keeps the prior entity and cursor when commit fails", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    await applyPullPage(adapter, storeId, page(1, "opaque-cursor-1"));
    adapter.beforeCommit = () => {
      throw new Error("Simulated pull commit failure.");
    };

    await expect(
      applyPullPage(adapter, storeId, page(2, "opaque-cursor-2")),
    ).rejects.toThrow("Simulated pull commit failure.");
    expect(
      database
        .prepare(
          "SELECT label, remote_version FROM sync_test_entities WHERE id = ?",
        )
        .get(entityId),
    ).toEqual({ label: "Version 1", remote_version: 1 });
    expect(
      database
        .prepare("SELECT cursor FROM sync_inbox_state WHERE store_id = ?")
        .get(storeId),
    ).toEqual({ cursor: "opaque-cursor-1" });

    database.close();
  });
});
