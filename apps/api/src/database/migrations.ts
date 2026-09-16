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
