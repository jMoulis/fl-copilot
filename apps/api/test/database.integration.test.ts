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
