import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvironment } from "../src/config.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";

const testMongoUri = process.env.TEST_MONGODB_URI;
const describeWithMongo = testMongoUri ? describe : describe.skip;

describeWithMongo("MongoDB infrastructure", () => {
  let database: DatabaseService;
  const databaseName = `fl_copilot_test_${randomUUID().replaceAll("-", "")}`;

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
  });
});
