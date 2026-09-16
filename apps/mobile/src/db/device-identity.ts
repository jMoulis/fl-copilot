type SQLiteValue = string | number | null;

export interface DeviceIdentityDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export const DEVICE_ID_METADATA_KEY = "device_id";

export async function getOrCreateDeviceId(
  database: DeviceIdentityDatabase,
  createUuid: () => string,
) {
  const existing = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    DEVICE_ID_METADATA_KEY,
  );
  if (existing?.value) return existing.value;

  const candidate = createUuid();
  await database.runAsync(
    `
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `,
    DEVICE_ID_METADATA_KEY,
    candidate,
    new Date().toISOString(),
  );

  const persisted = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    DEVICE_ID_METADATA_KEY,
  );
  if (!persisted?.value) {
    throw new Error("Device identity could not be persisted.");
  }
  return persisted.value;
}
