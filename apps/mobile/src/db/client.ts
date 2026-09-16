import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { runLocalMigrations } from "./migrations";
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
    const schemaVersion = await runLocalMigrations(sqlite);
    const deviceId = await getOrCreateDeviceId(sqlite, randomUUID);
    return {
      sqlite,
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
