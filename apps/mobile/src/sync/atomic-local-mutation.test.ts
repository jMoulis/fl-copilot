import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import type { OutboxDatabase } from "./outbox-repository";
import { createSyncTestEntity } from "./sync-test-entity";

type SQLiteValue = string | number | null;

class NodeAtomicDatabase
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

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-atomic-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  return { adapter: new NodeAtomicDatabase(database), database };
}

function input() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    commandId: "22222222-2222-4222-8222-222222222222",
    storeId: "33333333-3333-4333-8333-333333333333",
    deviceId: "44444444-4444-4444-8444-444444444444",
    label: "Preuve locale",
    createdAt: "2026-09-26T21:00:00.000Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("atomic local mutation", () => {
  it("commits the business entity and its Outbox command together", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);

    const result = await createSyncTestEntity(adapter, input());

    expect(result.value).toEqual({
      id: input().id,
      storeId: input().storeId,
      label: "Preuve locale",
      remoteVersion: 0,
      createdAt: input().createdAt,
      updatedAt: input().createdAt,
    });
    expect(result.command).toMatchObject({
      commandId: input().commandId,
      entityId: input().id,
      commandType: "SYNC_TEST_ENTITY_UPSERT",
      localSequence: 1,
      status: "PENDING",
    });
    expect(
      database
        .prepare("SELECT id, label FROM sync_test_entities WHERE id = ?")
        .get(input().id),
    ).toEqual({ id: input().id, label: "Preuve locale" });
    expect(
      database.prepare("SELECT command_id, entity_id FROM sync_outbox").get(),
    ).toEqual({ command_id: input().commandId, entity_id: input().id });

    database.close();
  });

  it("rolls both writes back when an error occurs immediately before commit", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    adapter.beforeCommit = () => {
      throw new Error("Simulated failure before commit.");
    };

    await expect(createSyncTestEntity(adapter, input())).rejects.toThrow(
      "Simulated failure before commit.",
    );
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM sync_test_entities")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT value FROM app_metadata WHERE key = ?")
        .get("outbox_local_sequence"),
    ).toEqual({ value: "0" });

    database.close();
  });
});
