import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { runLocalMigrations } from "./migrations";
import { serializeLocalWrites } from "./serialized-writes";
import { localSchema } from "./schema";
import { getOrCreateDeviceId } from "./device-identity";
import { clearStoredSessionForDatabaseRecovery } from "../auth/auth-storage";
import {
  LocalDatabaseLifecycle,
  DatabaseStartupError,
  isSQLiteCorruption,
  type DatabaseLocation,
} from "./database-recovery";
import {
  databaseTarget,
  nativeDatabaseRecoveryStorage,
  preserveCorruptDatabase,
  preserveInvalidDatabaseHeader,
} from "./database-recovery-native";

export interface LocalDatabase {
  sqlite: SQLiteDatabase;
  orm: ExpoSQLiteDatabase<typeof localSchema>;
  schemaVersion: number;
  deviceId: string;
  recovery?: { recoveredAt: string };
}

let pendingCorruptClose:
  | {
      sqlite: SQLiteDatabase;
      location: DatabaseLocation;
      reason: unknown;
      preserved: boolean;
    }
  | undefined;

async function finishCorruptClose() {
  const pending = pendingCorruptClose;
  if (!pending) return;
  try {
    if (!pending.preserved) {
      await preserveCorruptDatabase(pending.location);
      pending.preserved = true;
    }
    await pending.sqlite.closeAsync();
    pendingCorruptClose = undefined;
  } catch (cause) {
    // Retain this handle until preservation + close succeed; retries cannot reopen or replace it.
    throw new DatabaseStartupError("UNAVAILABLE", { cause });
  }
  throw pending.reason;
}

async function openLocalDatabase(
  location: DatabaseLocation,
  create: boolean,
): Promise<LocalDatabase> {
  await finishCorruptClose();
  const target = await databaseTarget(location, create);
  let invalidHeader: boolean;
  try {
    invalidHeader = await preserveInvalidDatabaseHeader(location);
  } catch (cause) {
    throw new DatabaseStartupError("UNAVAILABLE", { cause });
  }
  if (invalidHeader) throw new DatabaseStartupError("CORRUPTION");
  let sqlite: SQLiteDatabase;
  try {
    sqlite = await openDatabaseAsync(target.name, undefined, target.directory);
  } catch (error) {
    if (isSQLiteCorruption(error)) {
      try {
        await preserveCorruptDatabase(location);
      } catch (cause) {
        throw new DatabaseStartupError("UNAVAILABLE", { cause });
      }
    }
    throw error;
  }

  try {
    await sqlite.execAsync("PRAGMA busy_timeout = 5000;");
    const schemaVersion = await runLocalMigrations(sqlite);
    const deviceId = await getOrCreateDeviceId(sqlite, randomUUID);
    return {
      sqlite: serializeLocalWrites(sqlite),
      orm: drizzle(sqlite, { schema: localSchema }),
      schemaVersion,
      deviceId,
      ...(location.recoveredAt
        ? { recovery: { recoveredAt: location.recoveredAt } }
        : {}),
    };
  } catch (error) {
    if (isSQLiteCorruption(error)) {
      pendingCorruptClose = {
        sqlite,
        location,
        reason: error,
        preserved: false,
      };
      await finishCorruptClose();
    }
    try {
      await sqlite.closeAsync();
    } catch (cause) {
      // A live/unknown handle must never be bypassed by changing the active location.
      throw new DatabaseStartupError("UNAVAILABLE", { cause });
    }
    throw error;
  }
}

const lifecycle = new LocalDatabaseLifecycle({
  storage: nativeDatabaseRecoveryStorage,
  open: openLocalDatabase,
  close: async (database) => {
    await database.sqlite.closeAsync();
  },
  clearAuthentication: async (location) => {
    if (!location.generation)
      throw new Error("LOCAL_RECOVERY_TARGET_UNAVAILABLE");
    await clearStoredSessionForDatabaseRecovery(location.generation);
  },
});

export function initializeLocalDatabase() {
  return lifecycle.initialize();
}

export const recoverLocalDatabase = () => lifecycle.recover();
