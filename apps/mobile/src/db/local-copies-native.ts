import { Directory, File } from "expo-file-system";
import {
  backupDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import {
  assertDatabaseCopyOwner,
  preserveDatabaseRecoveryOwner,
  readDatabaseRecoveryOwner,
} from "../auth/auth-storage";
import {
  databaseName,
  databaseInstallation,
  databaseTarget,
  databaseFileFingerprint,
  copyStableDatabaseFiles,
  manifestSchema,
  nativeDatabaseRecoveryStorage as storage,
} from "./database-recovery-native";
import { isSQLiteCorruption, type DatabaseLocation } from "./database-recovery";
import { OutboxRepository } from "../sync/outbox-repository";
import { runLocalMigrations } from "./migrations";
import { withSerializedDatabaseTask } from "./serialized-writes";
import {
  LocalCopyError,
  localCopyManifestSchema,
  preparedLocalCopySchema,
  type LocalCopyRef,
  type PreparedLocalCopy,
  type RecoveryOwner,
} from "./local-copy-contracts";

const same = (a: DatabaseLocation, b: DatabaseLocation) =>
  JSON.stringify(a) === JSON.stringify(b);
const locationKey = (v: DatabaseLocation) => v.generation ?? "initial";
let working = false;
async function exclusively<T>(action: () => Promise<T>) {
  if (working) throw new LocalCopyError("UNAVAILABLE");
  working = true;
  try {
    return await action();
  } catch (error) {
    if (
      isSQLiteCorruption(error) ||
      error instanceof z.ZodError ||
      (error instanceof Error &&
        /newer than supported version/.test(error.message))
    )
      throw new LocalCopyError("INVALID");
    throw error;
  } finally {
    working = false;
  }
}
async function privateDirectory() {
  const { root, id } = await databaseInstallation();
  const directory = new Directory(root, id);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}
async function parent(location: DatabaseLocation) {
  const target = await databaseTarget(location, false);
  return manifestSchema.parse(
    JSON.parse(await new File(target.directory, "manifest.json").text()),
  ).previous;
}
/** Only generations reachable from the active route carry trusted previous-owner traces. */
async function ancestors() {
  const result = new Map<
    string,
    { location: DatabaseLocation; owner: RecoveryOwner; date: string }
  >();
  let location = await storage.readLocation();
  for (let n = 0; location.generation; n++) {
    if (n >= 100 || result.has(locationKey(location)))
      throw new LocalCopyError("INVALID");
    const previous = await parent(location);
    const owner = await readDatabaseRecoveryOwner(location.generation);
    if (owner)
      result.set(locationKey(previous), {
        location: previous,
        owner,
        date: location.recoveredAt!,
      });
    location = previous;
  }
  return result;
}
export async function listLocalCopies(
  ownerId: string,
  storeId: string,
): Promise<LocalCopyRef[]> {
  await assertDatabaseCopyOwner(ownerId, storeId);
  const root = await privateDirectory(),
    history = await ancestors(),
    result: LocalCopyRef[] = [];
  for (const entry of root.list()) {
    if (
      !(entry instanceof Directory) ||
      !/^(copy|isolated)-[a-f0-9-]{36}$/.test(entry.name)
    )
      continue;
    const kind = entry.name.startsWith("copy-") ? "backup" : "isolated";
    try {
      const manifest = localCopyManifestSchema.parse(
        JSON.parse(
          await new File(
            entry,
            kind === "backup" ? "copy.json" : "snapshot.json",
          ).text(),
        ),
      );
      const owner =
        kind === "backup"
          ? await readDatabaseRecoveryOwner(entry.name.slice(5))
          : history.get(locationKey(manifest.location))?.owner;
      if (owner?.ownerId === ownerId && owner.storeIds.includes(storeId)) {
        result.push({
          kind,
          id: entry.name,
          createdAt: manifest.createdAt,
          location: manifest.location,
        });
      }
    } catch {
      /* Incomplete/unknown copies remain on disk, never presented as recoverable. */
    }
  }
  for (const [id, item] of history) {
    if (item.owner.ownerId === ownerId && item.owner.storeIds.includes(storeId))
      result.push({
        kind: "previous",
        id,
        location: item.location,
        createdAt: item.date,
      });
  }
  await assertDatabaseCopyOwner(ownerId, storeId);
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** quick_check/FKs and known migrations run only on a disposable working copy. */
async function verify(database: SQLiteDatabase, expectedDeviceId?: string) {
  const integrity =
    await database.getAllAsync<Record<string, unknown>>("PRAGMA quick_check");
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== "ok")
    throw new LocalCopyError("INVALID");
  await runLocalMigrations(database);
  if ((await database.getAllAsync("PRAGMA foreign_key_check")).length)
    throw new LocalCopyError("INVALID");
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key='device_id'",
  );
  const deviceId = z.uuid().parse(row?.value);
  if (expectedDeviceId && deviceId !== expectedDeviceId)
    throw new LocalCopyError("CHANGED");
  // A copy keeps the original device and command journal; never re-key or acknowledge a command.
  const invalid = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_outbox WHERE device_id != ?",
    deviceId,
  );
  if (invalid?.count) throw new LocalCopyError("INVALID");
  return deviceId;
}
async function validateFiles(
  directory: Directory,
  manifest: z.infer<typeof localCopyManifestSchema>,
) {
  for (const expected of manifest.files) {
    const value = await databaseFileFingerprint(
      new File(directory, expected.name),
    );
    if (
      value.sizeBytes !== expected.sizeBytes ||
      value.checksum !== expected.checksum
    )
      throw new LocalCopyError("CHANGED");
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const name = `${databaseName}${suffix}`;
    if (
      new File(directory, name).exists !==
      manifest.files.some((f) => f.name === name)
    )
      throw new LocalCopyError("CHANGED");
  }
}
export function createLocalCopy(
  database: SQLiteDatabase,
  deviceId: string,
  ownerId: string,
  storeId: string,
  assertCurrent: () => void,
) {
  return exclusively(async () => {
    const owner = await assertDatabaseCopyOwner(ownerId, storeId);
    assertCurrent();
    const location = await storage.readLocation(),
      id = randomUUID(),
      directory = new Directory(await privateDirectory(), `copy-${id}`);
    directory.create();
    const copy = await openDatabaseAsync(
      databaseName,
      { useNewConnection: true },
      directory.uri,
    );
    try {
      await withSerializedDatabaseTask(database, async () => {
        assertCurrent();
        await backupDatabaseAsync({
          sourceDatabase: database,
          destDatabase: copy,
        });
      });
      await verify(copy, deviceId);
      // A checkpointed single-file snapshot is complete even when the live source uses WAL.
      await copy.execAsync(
        "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
      );
    } finally {
      await copy.closeAsync();
    }
    assertCurrent();
    await assertDatabaseCopyOwner(ownerId, storeId);
    if (!same(location, await storage.readLocation()))
      throw new LocalCopyError("CHANGED");
    await preserveDatabaseRecoveryOwner(id, owner);
    const file = await databaseFileFingerprint(
      new File(directory, databaseName),
    );
    const manifest = localCopyManifestSchema.parse({
      version: 1,
      location,
      createdAt: new Date().toISOString(),
      files: [{ name: databaseName, ...file }],
    });
    const marker = new File(directory, "copy.json");
    marker.create();
    marker.write(JSON.stringify(manifest));
    if ((await marker.text()) !== JSON.stringify(manifest))
      throw new LocalCopyError("UNAVAILABLE");
    return {
      kind: "backup" as const,
      id: directory.name,
      location,
      createdAt: manifest.createdAt,
    };
  });
}
export function prepareLocalCopy(
  ref: LocalCopyRef,
  ownerId: string,
  storeId: string,
  assertCurrent: () => void,
): Promise<PreparedLocalCopy> {
  return exclusively(async () => {
    const owner = await assertDatabaseCopyOwner(ownerId, storeId);
    const allowed = (await listLocalCopies(ownerId, storeId)).find(
      (v) =>
        v.id === ref.id &&
        v.kind === ref.kind &&
        same(v.location, ref.location),
    );
    if (!allowed) throw new LocalCopyError("OWNER");
    assertCurrent();
    const previous = await storage.readLocation(),
      next = await storage.prepareLocation(previous),
      target = await databaseTarget(next, true);
    const directory = new Directory(target.directory);
    if (ref.kind === "previous") {
      const sourceTarget = await databaseTarget(allowed.location, false);
      await copyStableDatabaseFiles(sourceTarget.directory, directory);
    } else {
      const source = new Directory(await privateDirectory(), ref.id);
      const manifest = localCopyManifestSchema.parse(
        JSON.parse(
          await new File(
            source,
            ref.kind === "backup" ? "copy.json" : "snapshot.json",
          ).text(),
        ),
      );
      await validateFiles(source, manifest);
      for (const file of manifest.files)
        await new File(source, file.name).copy(new File(directory, file.name));
      await validateFiles(source, manifest);
      await validateFiles(directory, manifest);
    }
    const candidate = await openDatabaseAsync(
      databaseName,
      { useNewConnection: true },
      directory.uri,
    );
    let deviceId: string, pendingCount: number;
    try {
      deviceId = await verify(candidate);
      const count = await new OutboxRepository(candidate).countActive(
        storeId,
        ownerId,
      );
      pendingCount = count.pending_count + count.failed_count;
      await candidate.execAsync(
        "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
      );
    } finally {
      await candidate.closeAsync();
    }
    assertCurrent();
    await assertDatabaseCopyOwner(ownerId, storeId);
    if (!same(previous, await storage.readLocation()))
      throw new LocalCopyError("CHANGED");
    // The next generation records BOTH the retained old location and its known owner.
    await preserveDatabaseRecoveryOwner(next.generation!, owner);
    const fingerprint = await databaseFileFingerprint(
      new File(directory, databaseName),
    );
    const prepared = preparedLocalCopySchema.parse({
      version: 1,
      previous,
      next,
      ownerId,
      storeId,
      deviceId,
      pendingCount,
      ...fingerprint,
    });
    const marker = new File(directory, "restore.json");
    marker.create();
    marker.write(JSON.stringify(prepared));
    if ((await marker.text()) !== JSON.stringify(prepared))
      throw new LocalCopyError("UNAVAILABLE");
    return prepared;
  });
}
/** Called only after the root has stopped operational providers and drained canonical logout. */
export async function activatePreparedLocalCopy(value: PreparedLocalCopy) {
  const prepared = preparedLocalCopySchema.parse(value),
    target = await databaseTarget(prepared.next, false);
  const recorded = preparedLocalCopySchema.parse(
    JSON.parse(await new File(target.directory, "restore.json").text()),
  );
  if (JSON.stringify(recorded) !== JSON.stringify(prepared))
    throw new LocalCopyError("CHANGED");
  const owner = await readDatabaseRecoveryOwner(prepared.next.generation!);
  if (
    owner?.ownerId !== prepared.ownerId ||
    !owner.storeIds.includes(prepared.storeId)
  )
    throw new LocalCopyError("OWNER");
  const fingerprint = await databaseFileFingerprint(
    new File(target.directory, databaseName),
  );
  if (
    fingerprint.checksum !== prepared.checksum ||
    fingerprint.sizeBytes !== prepared.sizeBytes
  )
    throw new LocalCopyError("CHANGED");
  // The old database is retained, never closed/reopened under live callbacks; restart selects the new route.
  const active = await storage.readLocation();
  if (same(active, prepared.next)) return; // lost activation ACK
  await storage.activateLocation(prepared.previous, prepared.next);
}
export async function restoredDatabaseOwner(location: DatabaseLocation) {
  if (!location.generation) return undefined;
  const target = await databaseTarget(location, false),
    file = new File(target.directory, "restore.json");
  if (!file.exists) return undefined;
  const prepared = preparedLocalCopySchema.parse(JSON.parse(await file.text()));
  if (!same(prepared.next, location)) throw new LocalCopyError("INVALID");
  const owner = await readDatabaseRecoveryOwner(location.generation);
  if (owner?.ownerId !== prepared.ownerId) throw new LocalCopyError("OWNER");
  return prepared.ownerId;
}
