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
import { ProductMasterRepository } from "../products/product-master-repository";

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

  it("renews a rejected token and acknowledges the same offline command exactly once", async () => {
    const { NativeSessionManager } = await import("../auth/session-manager");
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
    const marker = {
      user: { id: deviceId, email: "test@example.test", displayName: "Test" },
      stores: [{ storeId, name: "Test", role: "MANAGER" }],
    };
    let renewals = 0;
    const manager = new NativeSessionManager(
      { load: async () => null, save: async () => {}, clear: async () => {} },
      async () => {
        renewals++;
        return {
          ...marker,
          accessToken: "new",
          accessTokenExpiresAt: "2026-10-06T08:15:00Z",
          refreshToken: "rotated",
        };
      },
      () => Date.parse("2026-10-06T08:00:00Z"),
    );
    await manager.establish({
      ...marker,
      accessToken: "old",
      accessTokenExpiresAt: "2026-10-06T08:15:00Z",
      refreshToken: "initial",
    });
    const attempted: string[] = [];
    const applied = new Set<string>();
    const service = new MobileSyncService(
      adapter,
      {
        push: (request) =>
          manager.request(async (token) => {
            attempted.push(request.commands[0]!.commandId);
            if (token === "old")
              throw new ApiClientError(401, {
                code: "AUTH_SESSION_EXPIRED",
                messageFr: "Session expirée",
                retryable: false,
              });
            return {
              serverTime: "2026-10-06T08:00:00Z",
              results: request.commands.map((command) => {
                const duplicate = applied.has(command.commandId);
                applied.add(command.commandId);
                return {
                  commandId: command.commandId,
                  entityType: command.entityType,
                  entityId: command.entityId,
                  status: duplicate
                    ? ("ALREADY_APPLIED" as const)
                    : ("APPLIED" as const),
                  remoteVersion: 1,
                };
              }),
            };
          }),
        bootstrap: () => manager.request(async () => bootstrapResponse()),
        pull: () =>
          manager.request(async () => ({
            changes: [],
            nextCursor: "cursor-1",
            hasMore: false,
            serverTime: "2026-10-06T08:00:00Z",
          })),
      },
      { appVersion: "test", deviceId },
    );
    expect(await service.sync(storeId)).toMatchObject({ pushed: 1, failed: 0 });
    expect(await service.sync(storeId)).toMatchObject({ pushed: 0 });
    expect(renewals).toBe(1);
    expect(attempted).toEqual([commandId, commandId]);
    expect(applied.size).toBe(1);
    expect(
      database
        .prepare("SELECT status FROM sync_outbox WHERE command_id = ?")
        .get(commandId),
    ).toEqual({ status: "ACKNOWLEDGED" });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM sync_test_entities")
        .get(),
    ).toEqual({ count: 1 });
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

  it("does not overwrite a newer local product edit when an older push is acknowledged", async () => {
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
    const repository = new ProductMasterRepository(adapter);
    const product = {
      id: entityId,
      storeId,
      label: "Tomate locale v1",
      category: "VEGETABLE" as const,
      nature: "BULK" as const,
      salesUnit: "KG" as const,
      status: "ACTIVE" as const,
      version: 1,
      createdAt: "2026-09-26T08:00:00.000Z",
      updatedAt: "2026-09-26T08:00:00.000Z",
    };
    await repository.upsertProduct(product, { commandId, deviceId });
    const newerCommandId = "55555555-5555-4555-8555-555555555555";
    const transport: SyncTransport = {
      bootstrap: async () => {
        throw new Error("bootstrap must not run");
      },
      pull: async (_storeId, cursor) => emptyPull(cursor),
      push: async () => {
        await repository.upsertProduct(
          {
            ...product,
            label: "Tomate locale v2",
            version: 2,
            updatedAt: "2026-09-26T08:01:00.000Z",
          },
          {
            commandId: newerCommandId,
            deviceId,
            expectedRemoteVersion: null,
          },
        );
        return {
          results: [
            {
              commandId,
              status: "APPLIED",
              entityType: "product",
              entityId,
              remoteVersion: 1,
              remoteEntity: { ...product, version: 1 },
            },
          ],
          serverTime: "2026-09-26T08:02:00.000Z",
        };
      },
    };

    await expect(
      new MobileSyncService(adapter, transport, {
        appVersion: "0.1.0",
        deviceId,
      }).push(storeId),
    ).resolves.toMatchObject({ pushed: 1 });
    await expect(repository.getProduct(entityId)).resolves.toMatchObject({
      entity: { label: "Tomate locale v2", version: 2 },
      syncState: "PENDING",
      dirty: true,
    });
    expect(
      database
        .prepare("SELECT status FROM sync_outbox WHERE command_id = ?")
        .get(newerCommandId),
    ).toEqual({ status: "PENDING" });
    database.close();
  });
});

describe("ordered alias creation and cancellation", () => {
  async function prepareAlias() {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    const repository = new ProductMasterRepository(adapter);
    const alias = {
      id: entityId,
      storeId,
      productId: deviceId,
      alias: "TOMATE ALLONGE VRAC",
      normalizedAlias: "TOMATE ALLONGE VRAC",
      source: "WASTE_RECEIPT" as const,
      status: "VALIDATED" as const,
      confidence: 1,
      version: 1,
      createdAt: "2026-10-07T08:00:00.000Z",
      updatedAt: "2026-10-07T08:00:00.000Z",
      deletedAt: null,
    };
    await repository.upsertAlias(alias, { commandId, deviceId });
    await repository.delete(
      "product_alias",
      entityId,
      storeId,
      "2026-10-07T08:01:00.000Z",
      {
        commandId: "88888888-8888-4888-8888-888888888888",
        deviceId,
        expectedRemoteVersion: null,
      },
    );
    return { adapter, database, repository, alias };
  }
  it("acknowledges creation before sending the unsent deletion with its actual version", async () => {
    const { adapter, database, repository, alias } = await prepareAlias();
    const expected: Array<number | null | undefined> = [];
    const transport: SyncTransport = {
      bootstrap: async () => bootstrapResponse(),
      pull: async (_, cursor) => emptyPull(cursor),
      push: async (request) => {
        expect(request.commands).toHaveLength(1);
        const command = request.commands[0]!;
        expected.push(command.expectedRemoteVersion);
        if (command.type === "PRODUCT_ALIAS_DELETE")
          expect(command.expectedRemoteVersion).toBe(1);
        return {
          results: [
            {
              commandId: command.commandId,
              status: "APPLIED",
              entityType: "product_alias",
              entityId,
              remoteVersion: command.type === "PRODUCT_ALIAS_DELETE" ? 2 : 1,
              remoteEntity: alias,
            },
          ],
          serverTime: alias.updatedAt,
        };
      },
    };
    expect(
      await new MobileSyncService(adapter, transport, {
        appVersion: "test",
        deviceId,
      }).push(storeId),
    ).toMatchObject({ pushed: 2, conflicts: 0 });
    expect(expected).toEqual([null, 1]);
    expect(await repository.getAlias(entityId)).toBeNull();
    expect(database.prepare("SELECT status FROM sync_outbox").all()).toEqual([
      { status: "ACKNOWLEDGED" },
      { status: "ACKNOWLEDGED" },
    ]);
    database.close();
  });
  it("does not send a dependent deletion when creation conflicts", async () => {
    const { adapter, database, alias } = await prepareAlias();
    let requests = 0;
    const transport: SyncTransport = {
      bootstrap: async () => bootstrapResponse(),
      pull: async (_, cursor) => emptyPull(cursor),
      push: async (request) => {
        requests++;
        expect(request.commands).toHaveLength(1);
        expect(request.commands[0]?.type).toBe("PRODUCT_ALIAS_UPSERT");
        return {
          results: [
            {
              commandId,
              status: "CONFLICT",
              entityType: "product_alias",
              entityId,
              remoteVersion: 1,
              remoteEntity: alias,
            },
          ],
          serverTime: alias.updatedAt,
        };
      },
    };
    expect(
      await new MobileSyncService(adapter, transport, {
        appVersion: "test",
        deviceId,
      }).push(storeId),
    ).toMatchObject({ conflicts: 1 });
    expect(requests).toBe(1);
    expect(
      database
        .prepare(
          "SELECT expected_remote_version, attempt_count FROM sync_outbox WHERE command_type = 'PRODUCT_ALIAS_DELETE'",
        )
        .get(),
    ).toMatchObject({ expected_remote_version: null, attempt_count: 0 });
    database.close();
  });
});

it("refreshes bootstrap once when upgrading an existing cursor to commercial review", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialReviewPages = [];
  snapshot.entities.commercialReviewDecisions = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    { appVersion: "test", deviceId, commercialReview: true, maxRetries: 0 },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-review:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to visual PDF reading", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialVisualReadings = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    { appVersion: "test", deviceId, commercialVisual: true, maxRetries: 0 },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-visual:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to commercial store choices", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialOfferChoices = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    { appVersion: "test", deviceId, commercialChoices: true, maxRetries: 0 },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-choices:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to weekly store preparation", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialWeekPreparations = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      commercialPreparation: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-preparation:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to PDF reference decisions", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialVersionDecisions = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      commercialVersions: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-versions:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to commercial offer validation", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialValidatedOffers = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      commercialValidation: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-validation:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to validated commercial plans", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialWeekPlans = [];
  snapshot.entities.commercialPlanRevisions = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      commercialPlans: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-plans:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to commercial execution capture", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.commercialExecutionTasks = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      commercialExecution: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`commercial-execution:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to store context settings", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.storeContextSettings = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      storeContext: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`store-context:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to need-unit catalogue settings", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.needUnitCatalogue = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      needUnits: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`need-units:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to product-need memberships settings", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.productNeedMemberships = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      needMemberships: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`need-memberships:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});

it("refreshes bootstrap once when upgrading an existing cursor to directed substitutions", async () => {
  const { adapter, database } = temporaryDatabase();
  await runLocalMigrations(adapter);
  database
    .prepare(
      "INSERT INTO sync_inbox_state(store_id,cursor,protocol_version) VALUES (?, ?,1)",
    )
    .run(storeId, "old-cursor");
  let bootstraps = 0;
  const snapshot = bootstrapResponse();
  snapshot.entities.directedProductSubstitutions = [];
  const service = new MobileSyncService(
    adapter,
    {
      bootstrap: async () => {
        bootstraps++;
        return snapshot;
      },
      push: async () => ({ results: [], serverTime: new Date().toISOString() }),
      pull: async () => emptyPull("new-cursor"),
    },
    {
      appVersion: "test",
      deviceId,
      productSubstitutions: true,
      maxRetries: 0,
    },
  );
  await service.sync(storeId);
  await service.sync(storeId);
  expect(bootstraps).toBe(1);
  expect(
    database
      .prepare("SELECT value FROM app_metadata WHERE key=?")
      .get(`product-substitutions:${storeId}`),
  ).toEqual({ value: "1" });
  database.close();
});
