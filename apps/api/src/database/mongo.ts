import { MongoClient, type Db } from "mongodb";
import type { ApiConfig } from "../config.js";
import { runMongoMigrations } from "./migrations.js";
import type { DatabaseService, DatabaseStatus } from "./types.js";

export function createMongoDatabase(config: ApiConfig): DatabaseService {
  const client = new MongoClient(config.MONGODB_URI, {
    appName: "fl-copilot-api",
    maxPoolSize: config.MONGODB_MAX_POOL_SIZE,
    minPoolSize: 0,
    retryReads: true,
    retryWrites: true,
    serverSelectionTimeoutMS: 2_000,
    connectTimeoutMS: 5_000,
  });
  const database = client.db(config.MONGODB_DATABASE);
  let initialized = false;
  let initialization: Promise<void> | undefined;

  async function ensureReady(): Promise<void> {
    if (initialized) return;
    initialization ??= (async () => {
      await client.connect();
      await database.command({ ping: 1 });
      await runMongoMigrations(database);
      initialized = true;
    })().finally(() => {
      initialization = undefined;
    });
    await initialization;
  }

  return {
    async checkHealth(): Promise<DatabaseStatus> {
      try {
        await ensureReady();
        await database.command({ ping: 1 });
        return "connected";
      } catch {
        initialized = false;
        return "disconnected";
      }
    },
    async getDb(): Promise<Db> {
      await ensureReady();
      return database;
    },
    async close(): Promise<void> {
      initialized = false;
      await client.close();
    },
  };
}
