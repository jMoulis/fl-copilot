import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { ConflictRepository } from "./conflict-repository";
import type { OutboxCommand, OutboxDatabase } from "./outbox-repository";

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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ConflictRepository", () => {
  it("preserves both payloads and version metadata for an open conflict", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-conflict-"));
    temporaryDirectories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeSQLiteAdapter(database);
    await runLocalMigrations(adapter);
    const repository = new ConflictRepository(
      adapter,
      () => "2026-09-26T21:00:00.000Z",
    );
    const command: OutboxCommand = {
      commandId: "44444444-4444-4444-8444-444444444444",
      storeId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      localSequence: 1,
      commandType: "SYNC_TEST_ENTITY_UPSERT",
      entityType: "sync_test_entity",
      entityId: "33333333-3333-4333-8333-333333333333",
      expectedRemoteVersion: 1,
      payload: { label: "Version locale" },
      createdAt: "2026-09-26T20:00:00.000Z",
      status: "SYNCING",
      attemptCount: 1,
      lastAttemptAt: "2026-09-26T20:01:00.000Z",
      lastErrorCode: null,
    };

    await repository.recordPushConflict(command, {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteVersion: 2,
      remoteEntity: { label: "Version distante" },
      error: {
        code: "SYNC_VERSION_CONFLICT",
        messageFr: "Cette donnée a été modifiée sur un autre appareil.",
        retryable: false,
      },
    });

    await expect(repository.listOpen(command.storeId)).resolves.toEqual([
      expect.objectContaining({
        id: command.commandId,
        localPayload: { label: "Version locale" },
        remotePayload: { label: "Version distante" },
        localExpectedVersion: 1,
        remoteVersion: 2,
        conflictType: "SYNC_VERSION_CONFLICT",
        status: "OPEN",
      }),
    ]);
    database.close();
  });
});
