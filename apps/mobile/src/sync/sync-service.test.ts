import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import type {
  BootstrapResponse,
  SyncPullResponse,
} from "@fl-copilot/sync-contracts";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import type { OutboxDatabase } from "./outbox-repository";
import { MobileSyncService, type SyncTransport } from "./sync-service";
import { createSyncTestEntity } from "./sync-test-entity";

type SQLiteValue = string | number | null;

class NodeSyncDatabase
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
const deviceId = "22222222-2222-4222-8222-222222222222";
const entityId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-service-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  return { adapter: new NodeSyncDatabase(database), database };
}

function bootstrapResponse(): BootstrapResponse {
  return {
    protocolVersion: 1,
    store: { id: storeId, name: "Magasin test", role: "MANAGER" },
    snapshotRevision: "revision-1",
    cursor: "cursor-1",
    historyPolicy: { rawObservationDays: 90 },
    entities: {
      syncTestEntities: [
        {
          id: entityId,
          storeId,
          label: "Créée hors connexion",
          remoteVersion: 1,
          createdAt: "2026-09-26T08:00:00.000Z",
          updatedAt: "2026-09-26T08:01:00.000Z",
        },
      ],
      products: [],
      productIdentifiers: [],
      productAliases: [],
      needUnits: [],
      needMemberships: [],
      productSubstitutions: [],
      salesObservations: [],
      wasteObservations: [],
      commercialOperations: [],
      offers: [],
      marketSignals: [],
      executionInstructions: [],
      storeEvents: [],
      productDailyPerformance: [],
      departmentDailyPerformance: [],
      recommendations: [],
      decisions: [],
      actionExecutions: [],
    },
    serverTime: "2026-09-26T08:10:00.000Z",
  };
}

function emptyPull(cursor: string): SyncPullResponse {
  return {
    changes: [],
    nextCursor: cursor,
    hasMore: false,
    serverTime: "2026-09-26T08:11:00.000Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("mobile sync service", () => {
  it("shares one active cycle for concurrent triggers", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO sync_inbox_state (
            store_id, cursor, protocol_version, last_successful_sync_at
          ) VALUES (?, ?, 1, NULL)
        `,
      )
      .run(storeId, "cursor-1");
    let releasePull: (() => void) | undefined;
    let notifyPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      notifyPullStarted = resolve;
    });
    const transport: SyncTransport = {
      bootstrap: async () => {
        throw new Error("bootstrap must not run");
      },
      push: async () => {
        throw new Error("push must not run without commands");
      },
      pull: async () => {
        notifyPullStarted?.();
        await new Promise<void>((resolve) => {
          releasePull = resolve;
        });
        return emptyPull("cursor-1");
      },
    };
    const service = new MobileSyncService(adapter, transport, {
      appVersion: "0.1.0",
      deviceId,
    });
    const concurrentService = new MobileSyncService(adapter, transport, {
      appVersion: "0.1.0",
      deviceId,
    });

    const first = service.sync(storeId);
    const second = concurrentService.sync(storeId);
    expect(second).toBe(first);
    await pullStarted;
    releasePull?.();
    await expect(first).resolves.toMatchObject({ pulled: 0, pushed: 0 });

    database.close();
  });

  it("retries the same command safely before bootstrap and pull", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    await createSyncTestEntity(adapter, {
      id: entityId,
      commandId,
      storeId,
      deviceId,
      label: "Créée hors connexion",
      createdAt: "2026-09-26T08:00:00.000Z",
    });
    const calls: string[] = [];
    const pushedCommandIds: string[][] = [];
    let pushAttempts = 0;
    const transport: SyncTransport = {
      push: async (request) => {
        calls.push("push");
        pushedCommandIds.push(
          request.commands.map((command) => command.commandId),
        );
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Réseau indisponible.",
            retryable: true,
          });
        }
        if (pushAttempts === 2) {
          return {
            results: [
              {
                commandId,
                status: "RETRYABLE_ERROR",
                entityType: "sync_test_entity",
                entityId,
                error: {
                  code: "SYNC_TEMPORARILY_UNAVAILABLE",
                  messageFr: "Réessayez.",
                  retryable: true,
                },
              },
            ],
            serverTime: "2026-09-26T08:08:00.000Z",
          };
        }
        return {
          results: [
            {
              commandId,
              status: "APPLIED",
              entityType: "sync_test_entity",
              entityId,
              remoteVersion: 1,
            },
          ],
          serverTime: "2026-09-26T08:09:00.000Z",
        };
      },
      bootstrap: async () => {
        calls.push("bootstrap");
        return bootstrapResponse();
      },
      pull: async (_storeId, cursor) => {
        calls.push("pull");
        return emptyPull(cursor);
      },
    };
    const delays: number[] = [];
    const service = new MobileSyncService(adapter, transport, {
      appVersion: "0.1.0",
      deviceId,
      baseRetryDelayMs: 10,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      now: () => "2026-09-26T08:12:00.000Z",
    });

    await expect(service.sync(storeId)).resolves.toMatchObject({
      pushed: 1,
      pulled: 0,
      conflicts: 0,
      failed: 0,
      cursor: "cursor-1",
    });
    expect(calls).toEqual(["push", "push", "push", "bootstrap", "pull"]);
    expect(pushedCommandIds).toEqual([[commandId], [commandId], [commandId]]);
    expect(delays).toEqual([10, 10]);
    expect(
      database
        .prepare(
          "SELECT status, attempt_count FROM sync_outbox WHERE command_id = ?",
        )
        .get(commandId),
    ).toEqual({ status: "ACKNOWLEDGED", attempt_count: 2 });
    expect(
      database
        .prepare("SELECT cursor FROM sync_inbox_state WHERE store_id = ?")
        .get(storeId),
    ).toEqual({ cursor: "cursor-1" });

    database.close();
  });

  it("stores a remote version conflict without losing the local payload", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO sync_inbox_state (
            store_id, cursor, protocol_version, last_successful_sync_at
          ) VALUES (?, ?, 1, NULL)
        `,
      )
      .run(storeId, "cursor-1");
    await createSyncTestEntity(adapter, {
      id: entityId,
      commandId,
      storeId,
      deviceId,
      label: "Version locale conservée",
      createdAt: "2026-09-26T08:00:00.000Z",
    });
    const remoteEntity = {
      id: entityId,
      storeId,
      label: "Version distante",
      remoteVersion: 2,
      createdAt: "2026-09-26T07:00:00.000Z",
      updatedAt: "2026-09-26T08:05:00.000Z",
    };
    const transport: SyncTransport = {
      bootstrap: async () => {
        throw new Error("bootstrap must not run");
      },
      push: async () => ({
        results: [
          {
            commandId,
            status: "CONFLICT",
            entityType: "sync_test_entity",
            entityId,
            remoteVersion: 2,
            remoteEntity,
            error: {
              code: "SYNC_VERSION_CONFLICT",
              messageFr: "Cette donnée a été modifiée sur un autre appareil.",
              retryable: false,
            },
          },
        ],
        serverTime: "2026-09-26T08:10:00.000Z",
      }),
      pull: async (_storeId, cursor) => emptyPull(cursor),
    };
    const service = new MobileSyncService(adapter, transport, {
      appVersion: "0.1.0",
      deviceId,
      now: () => "2026-09-26T08:12:00.000Z",
    });

    await expect(service.sync(storeId)).resolves.toMatchObject({
      conflicts: 1,
      pushed: 0,
      failed: 0,
    });
    expect(
      database
        .prepare("SELECT label FROM sync_test_entities WHERE id = ?")
        .get(entityId),
    ).toEqual({ label: "Version locale conservée" });
    const conflict = database
      .prepare(
        `
          SELECT local_payload_json, remote_payload_json, remote_version,
                 conflict_type, status
          FROM sync_conflicts WHERE command_id = ?
        `,
      )
      .get(commandId) as {
      local_payload_json: string;
      remote_payload_json: string;
      remote_version: number;
      conflict_type: string;
      status: string;
    };
    expect(JSON.parse(conflict.local_payload_json)).toMatchObject({
      label: "Version locale conservée",
    });
    expect(JSON.parse(conflict.remote_payload_json)).toEqual(remoteEntity);
    expect(conflict).toMatchObject({
      remote_version: 2,
      conflict_type: "SYNC_VERSION_CONFLICT",
      status: "OPEN",
    });
    expect(
      database
        .prepare("SELECT status FROM sync_outbox WHERE command_id = ?")
        .get(commandId),
    ).toEqual({ status: "CONFLICT" });

    database.close();
  });
});
