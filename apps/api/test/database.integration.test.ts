import { randomUUID } from "node:crypto";
import { Long } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvironment } from "../src/config.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoAuthService } from "../src/auth/service.js";
import {
  createMongoProcessedCommandService,
  type MongoCommandMutationContext,
} from "../src/sync/processed-command-service.js";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service.js";
import { createMongoSyncPushService } from "../src/sync/push-service.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
import {
  createMongoSyncPullService,
  SyncPullCursorError,
} from "../src/sync/pull-service.js";

const testMongoUri = process.env.TEST_MONGODB_URI;
const describeWithMongo = testMongoUri ? describe : describe.skip;
const itWithMongoTransactions =
  process.env.TEST_MONGODB_TRANSACTIONS === "true" ? it : it.skip;

describeWithMongo("MongoDB infrastructure", () => {
  let database: DatabaseService;
  const databaseName = `flc_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

  beforeAll(async () => {
    database = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: testMongoUri,
        MONGODB_DATABASE: databaseName,
      }),
    );
    await database.getDb();
  });

  afterAll(async () => {
    const mongoDatabase = await database.getDb();
    await mongoDatabase.dropDatabase();
    await database.close();
  });

  it("creates and reads an isolated test entity", async () => {
    const mongoDatabase = await database.getDb();
    const collection = mongoDatabase.collection<{
      _id: string;
      label: string;
    }>("infrastructureTestEntities");
    const entity = { _id: randomUUID(), label: "MongoDB fonctionne" };

    await collection.insertOne(entity);

    await expect(collection.findOne({ _id: entity._id })).resolves.toEqual(
      entity,
    );
  });

  it("records the infrastructure migration exactly once", async () => {
    const mongoDatabase = await database.getDb();
    const migrations = mongoDatabase.collection<{
      _id: number;
      name: string;
      appliedAt: Date;
    }>("schemaMigrations");

    await expect(migrations.countDocuments({ _id: 1 })).resolves.toBe(1);
    await expect(migrations.findOne({ _id: 1 })).resolves.toMatchObject({
      _id: 1,
      name: "initialize-schema-migrations",
    });

    await expect(database.checkHealth()).resolves.toBe("connected");
    await expect(migrations.countDocuments({ _id: 1 })).resolves.toBe(1);
    await expect(migrations.findOne({ _id: 2 })).resolves.toMatchObject({
      _id: 2,
      name: "initialize-authentication-indexes",
    });
    await expect(migrations.findOne({ _id: 3 })).resolves.toMatchObject({
      _id: 3,
      name: "initialize-processed-command-indexes",
    });
    await expect(migrations.findOne({ _id: 4 })).resolves.toMatchObject({
      _id: 4,
      name: "initialize-sync-change-indexes",
    });
  });

  itWithMongoTransactions(
    "applies concurrent duplicate commands exactly once",
    async () => {
      const service = createMongoProcessedCommandService(database);
      const commandId = randomUUID();
      const entityId = randomUUID();
      const input = {
        commandId,
        storeId: randomUUID(),
        deviceId: randomUUID(),
        commandType: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId,
      };
      const mutate = async ({
        database: mongoDatabase,
        session,
      }: MongoCommandMutationContext) => {
        await mongoDatabase
          .collection<{ _id: string; mutationCount: number }>(
            "syncTestEntities",
          )
          .updateOne(
            { _id: entityId },
            { $inc: { mutationCount: 1 } },
            { upsert: true, session },
          );
        return {
          resultStatus: "APPLIED" as const,
          resultingVersion: 1,
          responseJson: { entityId },
        };
      };

      const outcomes = await Promise.all([
        service.execute(input, mutate),
        service.execute(input, mutate),
      ]);

      const mongoDatabase = await database.getDb();
      await expect(
        mongoDatabase
          .collection<{ _id: string; mutationCount: number }>(
            "syncTestEntities",
          )
          .findOne({ _id: entityId }),
      ).resolves.toMatchObject({ mutationCount: 1 });
      await expect(
        mongoDatabase
          .collection<{ _id: string }>("processedCommands")
          .countDocuments({ _id: commandId }),
      ).resolves.toBe(1);
      expect(
        outcomes.map(({ alreadyApplied }) => alreadyApplied).sort(),
      ).toEqual([false, true]);
    },
  );

  itWithMongoTransactions(
    "allocates unique ordered change sequences for concurrent mutations",
    async () => {
      const commands = createMongoProcessedCommandService(database);
      const changes = createMongoSyncChangeService();
      const storeId = randomUUID();
      const entityIds = Array.from({ length: 10 }, () => randomUUID());

      await Promise.all(
        entityIds.map((entityId) =>
          commands.execute(
            {
              commandId: randomUUID(),
              storeId,
              deviceId: randomUUID(),
              commandType: "SYNC_TEST_ENTITY_UPSERT",
              entityType: "sync_test_entity",
              entityId,
            },
            async (context) => {
              await context.database
                .collection<{ _id: string; version: number }>(
                  "syncTestEntities",
                )
                .insertOne(
                  { _id: entityId, version: 1 },
                  { session: context.session },
                );
              const change = await changes.append(context, {
                storeId,
                entityType: "sync_test_entity",
                entityId,
                operation: "UPSERT",
                entityVersion: 1,
              });
              return {
                resultStatus: "APPLIED",
                resultingVersion: 1,
                responseJson: { sequence: change.sequence.toString() },
              };
            },
          ),
        ),
      );

      const mongoDatabase = await database.getDb();
      const persisted = await mongoDatabase
        .collection<{ _id: string; storeId: string; sequence: Long }>(
          "syncChanges",
        )
        .find({ storeId })
        .sort({ sequence: 1 })
        .toArray();
      expect(persisted.map(({ sequence }) => sequence.toString())).toEqual(
        Array.from({ length: 10 }, (_, index) => String(index + 1)),
      );
      const counter = await mongoDatabase
        .collection<{ _id: string; nextSequence: Long }>("syncStoreCounters")
        .findOne({ _id: storeId });
      expect(counter?.nextSequence.toString()).toBe("10");
    },
  );

  itWithMongoTransactions(
    "returns independent results for a mixed push batch",
    async () => {
      const service = createMongoSyncPushService(database);
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const entityIds = [randomUUID(), randomUUID()];
      const commandIds = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      const timestamp = "2026-09-26T08:00:00.000Z";
      const createCommand = (
        commandId: string,
        entityId: string,
        localSequence: number,
      ) => ({
        commandId,
        localSequence,
        type: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId,
        expectedRemoteVersion: null,
        createdAt: timestamp,
        payload: {
          id: entityId,
          storeId,
          label: `Entité ${localSequence}`,
          remoteVersion: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      const firstCommand = createCommand(commandIds[0]!, entityIds[0]!, 1);
      const response = await service.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [
            firstCommand,
            {
              ...createCommand(commandIds[1]!, randomUUID(), 2),
              type: "UNSUPPORTED_COMMAND",
            },
            createCommand(commandIds[2]!, entityIds[1]!, 3),
            {
              ...createCommand(commandIds[3]!, entityIds[0]!, 4),
              expectedRemoteVersion: 0,
            },
          ],
        },
        "integration-request",
      );

      expect(response.results.map(({ status }) => status)).toEqual([
        "APPLIED",
        "REJECTED",
        "APPLIED",
        "CONFLICT",
      ]);
      const mongoDatabase = await database.getDb();
      await expect(
        mongoDatabase
          .collection("syncTestEntities")
          .countDocuments({ storeId }),
      ).resolves.toBe(2);
      await expect(
        mongoDatabase.collection("syncChanges").countDocuments({ storeId }),
      ).resolves.toBe(2);
      await expect(
        mongoDatabase
          .collection<{ _id: string }>("processedCommands")
          .countDocuments({ _id: { $in: commandIds } }),
      ).resolves.toBe(4);

      const replay = await service.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [firstCommand],
        },
        "replay-request",
      );
      expect(replay.results[0]).toMatchObject({
        commandId: commandIds[0],
        status: "ALREADY_APPLIED",
        remoteVersion: 1,
      });
      await expect(
        mongoDatabase.collection("syncChanges").countDocuments({ storeId }),
      ).resolves.toBe(2);
    },
  );

  itWithMongoTransactions(
    "returns store-scoped change pages in sequence order",
    async () => {
      const push = createMongoSyncPushService(database);
      const pull = createMongoSyncPullService(database);
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const timestamp = "2026-09-26T08:00:00.000Z";
      const commands = Array.from({ length: 3 }, (_, index) => {
        const entityId = randomUUID();
        return {
          commandId: randomUUID(),
          localSequence: index + 1,
          type: "SYNC_TEST_ENTITY_UPSERT",
          entityType: "sync_test_entity",
          entityId,
          expectedRemoteVersion: null,
          createdAt: timestamp,
          payload: {
            id: entityId,
            storeId,
            label: `Entité ${index + 1}`,
            remoteVersion: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      });
      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands,
        },
        "pull-fixture-request",
      );

      const firstPage = await pull.pull(storeId, { limit: 2 });
      expect(firstPage.changes.map(({ sequence }) => sequence)).toEqual([
        "1",
        "2",
      ]);
      expect(firstPage.changes.map(({ entity }) => entity)).toEqual([
        expect.objectContaining({ label: "Entité 1", remoteVersion: 1 }),
        expect.objectContaining({ label: "Entité 2", remoteVersion: 1 }),
      ]);
      expect(firstPage.hasMore).toBe(true);
      await expect(
        pull.pull(randomUUID(), { cursor: firstPage.nextCursor, limit: 2 }),
      ).rejects.toBeInstanceOf(SyncPullCursorError);

      const secondPage = await pull.pull(storeId, {
        cursor: firstPage.nextCursor,
        limit: 2,
      });
      expect(secondPage.changes.map(({ sequence }) => sequence)).toEqual(["3"]);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).not.toBe(firstPage.nextCursor);

      const emptyPage = await pull.pull(storeId, {
        cursor: secondPage.nextCursor,
        limit: 2,
      });
      expect(emptyPage.changes).toEqual([]);
      expect(emptyPage.nextCursor).toBe(secondPage.nextCursor);
      expect(emptyPage.hasMore).toBe(false);
    },
  );

  itWithMongoTransactions(
    "bootstraps a snapshot whose cursor precedes only later changes",
    async () => {
      const push = createMongoSyncPushService(database);
      const pull = createMongoSyncPullService(database);
      const bootstrap = createMongoSyncBootstrapService(
        database,
        () => new Date("2026-09-26T08:10:00.000Z"),
        () => "bootstrap-revision-1",
      );
      const storeId = randomUUID();
      const deviceId = randomUUID();
      const timestamp = "2026-09-26T08:00:00.000Z";
      const command = (localSequence: number) => {
        const entityId = randomUUID();
        return {
          commandId: randomUUID(),
          localSequence,
          type: "SYNC_TEST_ENTITY_UPSERT",
          entityType: "sync_test_entity",
          entityId,
          expectedRemoteVersion: null,
          createdAt: timestamp,
          payload: {
            id: entityId,
            storeId,
            label: `Bootstrap ${localSequence}`,
            remoteVersion: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      };
      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [command(1), command(2)],
        },
        "before-bootstrap",
      );

      const snapshot = await bootstrap.bootstrap(
        {
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId,
          storeId,
          storeName: "Magasin bootstrap",
          role: "MANAGER",
        },
        { rawObservationDays: 90 },
      );
      expect(snapshot).toMatchObject({
        snapshotRevision: "bootstrap-revision-1",
        store: { id: storeId, name: "Magasin bootstrap", role: "MANAGER" },
        historyPolicy: { rawObservationDays: 90 },
      });
      expect(snapshot.entities.syncTestEntities).toHaveLength(2);

      await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "0.1.0",
          deviceId,
          storeId,
          commands: [command(3)],
        },
        "after-bootstrap",
      );
      const later = await pull.pull(storeId, {
        cursor: snapshot.cursor,
        limit: 10,
      });
      expect(later.changes).toHaveLength(1);
      expect(later.changes[0]).toMatchObject({
        sequence: "3",
        entity: expect.objectContaining({ label: "Bootstrap 3" }),
      });
    },
  );

  it("verifies a one-time code, rotates refresh tokens and revokes reuse", async () => {
    const config = parseEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: testMongoUri,
      MONGODB_DATABASE: databaseName,
      AUTH_DEVELOPMENT_CODE: "123456",
    });
    const delivered: string[] = [];
    const auth = createMongoAuthService(database, config, async ({ code }) => {
      delivered.push(code);
    });
    const deviceId = randomUUID();
    const challenge = await auth.requestChallenge({
      email: "manager@example.test",
      deviceId,
      platform: "IOS",
      appVersion: "0.1.0",
    });
    expect(delivered).toEqual(["123456"]);

    const first = await auth.verifyChallenge(challenge.challengeId, "123456");
    expect(first.user.email).toBe("manager@example.test");
    expect(first.refreshToken).toHaveLength(43);
    const storeId = randomUUID();
    const mongoDatabase = await database.getDb();
    await mongoDatabase.collection("storeMemberships").insertOne({
      userId: first.user.id,
      storeId,
      storeName: "Magasin test",
      role: "MANAGER",
      active: true,
    });
    await expect(
      auth.authorizeStore(first.accessToken, storeId, deviceId),
    ).resolves.toMatchObject({
      userId: first.user.id,
      storeId,
      deviceId,
      role: "MANAGER",
    });
    await expect(
      auth.authorizeStore(first.accessToken, randomUUID(), deviceId),
    ).rejects.toMatchObject({ publicCode: "STORE_ACCESS_DENIED" });
    await expect(
      auth.verifyChallenge(challenge.challengeId, "123456"),
    ).rejects.toMatchObject({ publicCode: "AUTH_CODE_INVALID" });

    const rotated = await auth.refreshSession(deviceId, first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(
      auth.refreshSession(deviceId, first.refreshToken),
    ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
    await expect(
      auth.refreshSession(deviceId, rotated.refreshToken),
    ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
  });
});
