import type { Db } from "mongodb";

type MigrationRecord = {
  _id: number;
  name: string;
  appliedAt: Date;
};

export type MongoMigration = {
  version: number;
  name: string;
  up(database: Db): Promise<void>;
};

export const mongoMigrations: readonly MongoMigration[] = [
  {
    version: 1,
    name: "initialize-schema-migrations",
    async up(database) {
      await database
        .collection<MigrationRecord>("schemaMigrations")
        .createIndex({ name: 1 }, { unique: true });
    },
  },
  {
    version: 2,
    name: "initialize-authentication-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("users")
          .createIndex({ email: 1 }, { unique: true }),
        database
          .collection("authChallenges")
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection("authChallenges").createIndex({
          email: 1,
          deviceId: 1,
          createdAt: -1,
        }),
        database
          .collection("deviceSessions")
          .createIndex({ userId: 1, deviceId: 1 }, { unique: true }),
        database
          .collection("deviceSessions")
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database
          .collection("storeMemberships")
          .createIndex({ userId: 1, storeId: 1 }, { unique: true }),
      ]);
    },
  },
  {
    version: 3,
    name: "initialize-processed-command-indexes",
    async up(database) {
      await database
        .collection("processedCommands")
        .createIndex({ storeId: 1, processedAt: -1 });
    },
  },
  {
    version: 4,
    name: "initialize-sync-change-indexes",
    async up(database) {
      await database
        .collection("syncChanges")
        .createIndex({ storeId: 1, sequence: 1 }, { unique: true });
    },
  },
  {
    version: 5,
    name: "initialize-product-master-indexes",
    async up(database) {
      await Promise.all([
        database.collection("products").createIndex({ storeId: 1, status: 1 }),
        database.collection("productIdentifiers").createIndex(
          { storeId: 1, type: 1, value: 1 },
          {
            unique: true,
            partialFilterExpression: { deletedAt: null },
          },
        ),
        database
          .collection("productIdentifiers")
          .createIndex({ storeId: 1, productId: 1 }),
        database
          .collection("productAliases")
          .createIndex({ storeId: 1, normalizedAlias: 1 }),
        database
          .collection("productAliases")
          .createIndex({ storeId: 1, productId: 1 }),
      ]);
    },
  },
  {
    version: 6,
    name: "initialize-source-upload-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("sourceUploads")
          .createIndex({ storeId: 1, sourceDocumentId: 1 }, { unique: true }),
        database
          .collection("sourceUploads")
          .createIndex({ storeId: 1, objectKey: 1 }, { unique: true }),
        database
          .collection("sourceDocuments")
          .createIndex({ storeId: 1, checksum: 1 }),
      ]);
    },
  },
  {
    version: 7,
    name: "initialize-analytics-read-model-indexes",
    async up(database) {
      await Promise.all([
        database.collection("salesObservations").createIndex({
          storeId: 1,
          productId: 1,
          date: 1,
          validationStatus: 1,
        }),
        database.collection("wasteObservations").createIndex({
          storeId: 1,
          productId: 1,
          date: 1,
          validationStatus: 1,
        }),
        database
          .collection("productDailyPerformance")
          .createIndex({ storeId: 1, productId: 1, date: 1 }, { unique: true }),
        database
          .collection("departmentDailyPerformance")
          .createIndex({ storeId: 1, date: 1 }, { unique: true }),
      ]);
    },
  },
  {
    version: 8,
    name: "initialize-waste-receipt-extraction-indexes",
    async up(database) {
      await Promise.all([
        database.collection("wasteReceiptExtractions").createIndex(
          {
            storeId: 1,
            sourceDocumentId: 1,
            provider: 1,
            model: 1,
            schemaVersion: 1,
          },
          { unique: true },
        ),
        database.collection("sourceDocuments").createIndex({
          storeId: 1,
          sourceType: 1,
          extractionStatus: 1,
        }),
      ]);
    },
  },
];

export async function runMongoMigrations(
  database: Db,
  migrations: readonly MongoMigration[] = mongoMigrations,
): Promise<void> {
  const versions = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      throw new Error("MongoDB migration versions must be positive integers");
    }
    if (versions.has(migration.version)) {
      throw new Error(
        `MongoDB migration version ${migration.version} is declared more than once`,
      );
    }
    versions.add(migration.version);
  }

  const collection = database.collection<MigrationRecord>("schemaMigrations");
  const applied = await collection.find().sort({ _id: 1 }).toArray();
  const appliedByVersion = new Map(
    applied.map((record) => [record._id, record]),
  );

  for (const migration of [...migrations].sort(
    (left, right) => left.version - right.version,
  )) {
    const existing = appliedByVersion.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name) {
        throw new Error(
          `MongoDB migration ${migration.version} name does not match the recorded migration`,
        );
      }
      continue;
    }

    await migration.up(database);
    try {
      await collection.insertOne({
        _id: migration.version,
        name: migration.name,
        appliedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrent = await collection.findOne({ _id: migration.version });
      if (concurrent?.name !== migration.name) {
        throw new Error(
          `MongoDB migration ${migration.version} conflicted with another migration`,
        );
      }
    }
  }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
