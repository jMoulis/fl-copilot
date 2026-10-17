import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { runLocalMigrations } from "./migrations";
import { serializeLocalWrites } from "./serialized-writes";
import { localSchema } from "./schema";
import { getOrCreateDeviceId } from "./device-identity";

export interface LocalDatabase {
  sqlite: SQLiteDatabase;
  orm: ExpoSQLiteDatabase<typeof localSchema>;
  schemaVersion: number;
  deviceId: string;
}

let initialization: Promise<LocalDatabase> | undefined;

async function openLocalDatabase(): Promise<LocalDatabase> {
  const sqlite = await openDatabaseAsync("fl-copilot.db");

  try {
    await sqlite.execAsync("PRAGMA busy_timeout = 5000;");
    const schemaVersion = await runLocalMigrations(sqlite);
    const deviceId = await getOrCreateDeviceId(sqlite, randomUUID);
    return {
      sqlite: serializeLocalWrites(sqlite),
      orm: drizzle(sqlite, { schema: localSchema }),
      schemaVersion,
      deviceId,
    };
  } catch (error) {
    await sqlite.closeAsync();
    throw error;
  }
}

export function initializeLocalDatabase() {
  initialization ??= openLocalDatabase().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
