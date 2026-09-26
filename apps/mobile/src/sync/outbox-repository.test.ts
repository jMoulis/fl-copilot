import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import {
  OutboxRepository,
  subscribeOutboxChanges,
  type EnqueueOutboxCommand,
  type OutboxDatabase,
} from "./outbox-repository";

class NodeSQLiteAdapter implements OutboxDatabase {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: (string | number | null)[]) {
    return this.database.prepare(sql).run(...params);
  }
}

const temporaryDirectories: string[] = [];

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-outbox-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "local.db");
  const database = new DatabaseSync(path);
  return { adapter: new NodeSQLiteAdapter(database), database, path };
}

function command(
  commandId: string,
  overrides: Partial<EnqueueOutboxCommand> = {},
): EnqueueOutboxCommand {
  return {
    commandId,
    storeId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    commandType: "PRODUCT_UPSERT",
    entityType: "product",
    entityId: "33333333-3333-4333-8333-333333333333",
    expectedRemoteVersion: null,
    payload: { name: "Tomate" },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("OutboxRepository", () => {
  it("notifies subscribers when the pending command count changes", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    const repository = new OutboxRepository(adapter);
    const notification = new Promise<void>((resolve) => {
      const unsubscribe = subscribeOutboxChanges(() => {
        unsubscribe();
        resolve();
      });
    });

    await repository.enqueue(command("reactive-command"));

    await expect(notification).resolves.toBeUndefined();
    await expect(
      repository.listPending(command("unused").storeId),
    ).resolves.toHaveLength(1);
    database.close();
  });

  it("persists commands across restart with monotonic oldest-first sequences", async () => {
    const first = temporaryDatabase();
    await runLocalMigrations(first.adapter);
    const firstRepository = new OutboxRepository(
      first.adapter,
      () => "2026-09-26T20:00:00.000Z",
    );

    await firstRepository.enqueue(command("command-1"));
    await firstRepository.enqueue(command("command-2"));
    await firstRepository.enqueue(command("command-3"));
    first.database.close();

    const reopenedDatabase = new DatabaseSync(first.path);
    const reopenedAdapter = new NodeSQLiteAdapter(reopenedDatabase);
    await runLocalMigrations(reopenedAdapter);
    const reopenedRepository = new OutboxRepository(
      reopenedAdapter,
      () => "2026-09-26T20:01:00.000Z",
    );
    await reopenedRepository.enqueue(command("command-4"));

    const pending = await reopenedRepository.listPending(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(
      pending.map(({ commandId, localSequence }) => ({
        commandId,
        localSequence,
      })),
    ).toEqual([
      { commandId: "command-1", localSequence: 1 },
      { commandId: "command-2", localSequence: 2 },
      { commandId: "command-3", localSequence: 3 },
      { commandId: "command-4", localSequence: 4 },
    ]);

    reopenedDatabase.close();
  });

  it("records attempts and enforces retry and terminal state transitions", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    let now = "2026-09-26T20:00:00.000Z";
    const repository = new OutboxRepository(adapter, () => now);
    await repository.enqueue(command("retry-command"));

    now = "2026-09-26T20:01:00.000Z";
    await repository.markSyncing("retry-command");
    await expect(repository.markSyncing("retry-command")).rejects.toThrow(
      "PENDING -> SYNCING",
    );
    expect(await repository.getById("retry-command")).toMatchObject({
      status: "SYNCING",
      attemptCount: 1,
      lastAttemptAt: now,
      lastErrorCode: null,
    });

    await repository.markPendingForRetry(
      "retry-command",
      "EXTERNAL_PROVIDER_UNAVAILABLE",
    );
    expect(
      await repository.listPending(command("unused").storeId),
    ).toHaveLength(1);

    now = "2026-09-26T20:02:00.000Z";
    await repository.markSyncing("retry-command");
    await repository.markFailed("retry-command", "INVALID_ENTITY_STATE");
    expect(await repository.getById("retry-command")).toMatchObject({
      status: "FAILED",
      attemptCount: 2,
      lastAttemptAt: now,
      lastErrorCode: "INVALID_ENTITY_STATE",
    });
    expect(await repository.listPending(command("unused").storeId)).toEqual([]);

    database.close();
  });

  it("recovers commands left syncing by an interrupted run", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    const repository = new OutboxRepository(
      adapter,
      () => "2026-09-26T20:00:00.000Z",
    );
    const input = command("interrupted-command");
    await repository.enqueue(input);
    await repository.markSyncing(input.commandId);

    await expect(repository.recoverInterrupted(input.storeId)).resolves.toBe(1);
    expect(await repository.getById(input.commandId)).toMatchObject({
      status: "PENDING",
      attemptCount: 1,
      lastErrorCode: "SYNC_INTERRUPTED",
    });

    database.close();
  });
});
