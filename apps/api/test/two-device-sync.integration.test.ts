import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvironment } from "../src/config.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
import { createMongoSyncPullService } from "../src/sync/pull-service.js";
import { createMongoSyncPushService } from "../src/sync/push-service.js";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../../mobile/src/db/migrations.js";
import type { AtomicMutationDatabase } from "../../mobile/src/sync/atomic-local-mutation.js";
import type { OutboxDatabase } from "../../mobile/src/sync/outbox-repository.js";
import {
  MobileSyncService,
  type SyncTransport,
} from "../../mobile/src/sync/sync-service.js";
import { createSyncTestEntity } from "../../mobile/src/sync/sync-test-entity.js";

type SQLiteValue = string | number | null;

class DeviceDatabase
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

const testMongoUri = process.env.TEST_MONGODB_URI;
const describeWithMongoTransactions =
  testMongoUri && process.env.TEST_MONGODB_TRANSACTIONS === "true"
    ? describe
    : describe.skip;

describeWithMongoTransactions("M1 two-device synchronization proof", () => {
  let remoteDatabase: DatabaseService;
  const databaseName = `flc_m1_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const localDirectories: string[] = [];

  beforeAll(async () => {
    remoteDatabase = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: testMongoUri,
        MONGODB_DATABASE: databaseName,
      }),
    );
    await remoteDatabase.getDb();
  });

  afterAll(async () => {
    const mongoDatabase = await remoteDatabase.getDb();
    await mongoDatabase.dropDatabase();
    await remoteDatabase.close();
    for (const directory of localDirectories) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("propagates one offline entity from restarted device A to device B", async () => {
    const storeId = randomUUID();
    const entityId = randomUUID();
    const commandId = randomUUID();
    const deviceAId = randomUUID();
    const deviceBId = randomUUID();
    const timestamp = "2026-09-26T08:00:00.000Z";
    const deviceAPath = createLocalDatabasePath("device-a");
    const deviceBPath = createLocalDatabasePath("device-b");
    const deviceB = await openDevice(deviceBPath);
    const remoteNow = () => new Date("2026-09-26T08:10:00.000Z");
    const push = createMongoSyncPushService(remoteDatabase, remoteNow);
    const pull = createMongoSyncPullService(remoteDatabase, remoteNow);
    const bootstrap = createMongoSyncBootstrapService(
      remoteDatabase,
      remoteNow,
      () => "bootstrap-revision",
    );
    const transportFor = (deviceId: string): SyncTransport => ({
      push: (request) => push.push(request, `request-${deviceId}`),
      pull: (pulledStoreId, cursor) =>
        pull.pull(pulledStoreId, { cursor, limit: 500 }),
      bootstrap: (bootstrappedStoreId) =>
        bootstrap.bootstrap(
          {
            userId: randomUUID(),
            sessionId: randomUUID(),
            deviceId,
            storeId: bootstrappedStoreId,
            storeName: "Magasin preuve M1",
            role: "MANAGER",
          },
          { rawObservationDays: 90 },
        ),
    });

    // Device B starts with a cursor before A creates anything, so its later
    // synchronization proves incremental pull rather than snapshot bootstrap.
    await new MobileSyncService(deviceB, transportFor(deviceBId), {
      appVersion: "0.1.0",
      deviceId: deviceBId,
    }).bootstrap(storeId);

    const deviceABeforeRestart = await openDevice(deviceAPath);
    await createSyncTestEntity(deviceABeforeRestart, {
      id: entityId,
      commandId,
      storeId,
      deviceId: deviceAId,
      label: "Créée hors connexion sur A",
      createdAt: timestamp,
    });
    deviceABeforeRestart.database.close();

    const deviceAAfterRestart = await openDevice(deviceAPath);
    expect(readLocalEntity(deviceAAfterRestart, entityId)).toEqual({
      id: entityId,
      store_id: storeId,
      label: "Créée hors connexion sur A",
      remote_version: 0,
    });
    expect(
      deviceAAfterRestart.database
        .prepare("SELECT status FROM sync_outbox WHERE command_id = ?")
        .get(commandId),
    ).toEqual({ status: "PENDING" });
    const deviceAService = new MobileSyncService(
      deviceAAfterRestart,
      transportFor(deviceAId),
      { appVersion: "0.1.0", deviceId: deviceAId },
    );
    await expect(deviceAService.sync(storeId)).resolves.toMatchObject({
      pushed: 1,
      conflicts: 0,
      failed: 0,
    });

    const deviceBService = new MobileSyncService(
      deviceB,
      transportFor(deviceBId),
      { appVersion: "0.1.0", deviceId: deviceBId },
    );
    await expect(deviceBService.sync(storeId)).resolves.toMatchObject({
      pushed: 0,
      pulled: 1,
    });

    const expectedEntity = {
      id: entityId,
      store_id: storeId,
      label: "Créée hors connexion sur A",
      remote_version: 1,
    };
    expect(readLocalEntity(deviceAAfterRestart, entityId)).toEqual(
      expectedEntity,
    );
    expect(readLocalEntity(deviceB, entityId)).toEqual(expectedEntity);

    const mongoDatabase = await remoteDatabase.getDb();
    await expect(
      mongoDatabase
        .collection<{ _id: string; storeId: string }>("syncTestEntities")
        .countDocuments({ _id: entityId, storeId }),
    ).resolves.toBe(1);
    await expect(
      mongoDatabase
        .collection<{ _id: string }>("processedCommands")
        .countDocuments({ _id: commandId }),
    ).resolves.toBe(1);
    await expect(
      mongoDatabase
        .collection<{ entityId: string; storeId: string }>("syncChanges")
        .countDocuments({ entityId, storeId }),
    ).resolves.toBe(1);

    deviceAAfterRestart.database.close();
    deviceB.database.close();
  });

  function createLocalDatabasePath(label: string) {
    const directory = mkdtempSync(join(tmpdir(), `fl-copilot-${label}-`));
    localDirectories.push(directory);
    return join(directory, "local.db");
  }
});

async function openDevice(path: string) {
  const device = new DeviceDatabase(new DatabaseSync(path));
  await runLocalMigrations(device);
  return device;
}

function readLocalEntity(device: DeviceDatabase, entityId: string) {
  return device.database
    .prepare(
      `
        SELECT id, store_id, label, remote_version
        FROM sync_test_entities WHERE id = ?
      `,
    )
    .get(entityId);
}
