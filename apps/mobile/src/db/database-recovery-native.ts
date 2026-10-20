import { z } from "zod";
import { randomUUID } from "expo-crypto";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { File } from "expo-file-system";
import {
  databaseLocationSchema,
  initialDatabaseLocation,
  type DatabaseLocation,
  type DatabaseRecoveryStorage,
} from "./database-recovery";

const databaseName = "fl-copilot.db";
const manifestSchema = z
  .object({
    version: z.literal(1),
    previous: databaseLocationSchema,
    next: databaseLocationSchema,
  })
  .strict();

/** Installation-local marker prevents retained iOS Keychain entries selecting a removed app container. */
async function installation() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const root = new Directory(Paths.document, "database-recovery");
  root.create({ idempotent: true, intermediates: true });
  const marker = new File(root, "installation.json");
  if (!marker.exists) {
    if (root.list().some((entry) => !entry.name.endsWith(".installation-part")))
      throw new Error("LOCAL_RECOVERY_INSTALLATION_UNAVAILABLE");
    const pending = new File(root, `${randomUUID()}.installation-part`);
    pending.create();
    pending.write(JSON.stringify({ version: 1, id: randomUUID() }));
    await pending.move(marker);
  }
  const value = z
    .object({ version: z.literal(1), id: z.uuid() })
    .strict()
    .parse(JSON.parse(await marker.text()));
  return { root, id: value.id, key: `local.database.route.${value.id}` };
}

async function readLocation() {
  const { key, root, id } = await installation();
  const secure = await import("expo-secure-store");
  const saved = await secure.getItemAsync(key);
  if (saved !== null) return databaseLocationSchema.parse(JSON.parse(saved));
  const { Directory } = await import("expo-file-system");
  if (new Directory(root, id).exists)
    throw new Error("LOCAL_RECOVERY_POINTER_UNAVAILABLE");
  // Establish the original target before any candidate can be prepared.
  await secure.setItemAsync(key, JSON.stringify(initialDatabaseLocation));
  return initialDatabaseLocation;
}

export async function databaseTarget(
  location: DatabaseLocation,
  create: boolean,
) {
  databaseLocationSchema.parse(location);
  if (!location.generation)
    return { name: databaseName, directory: defaultDatabaseDirectory };
  const { root, id } = await installation();
  const { Directory, File } = await import("expo-file-system");
  const directory = new Directory(root, id, location.generation);
  const manifest = manifestSchema.parse(
    JSON.parse(await new File(directory, "manifest.json").text()),
  );
  if (
    !same(manifest.next, location) ||
    (!create && !new File(directory, databaseName).exists)
  )
    throw new Error("LOCAL_RECOVERY_TARGET_UNAVAILABLE");
  return { name: databaseName, directory: directory.uri };
}

const same = (a: DatabaseLocation, b: DatabaseLocation) =>
  a.generation === b.generation && a.recoveredAt === b.recoveredAt;

async function fingerprint(file: File) {
  const sizeBytes = file.size;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
    throw new Error("LOCAL_RECOVERY_FILE_UNREADABLE");
  const { FileMode } = await import("expo-file-system");
  const handle = file.open(FileMode.ReadOnly),
    digest = sha256.create();
  let read = 0,
    chunks = 0;
  try {
    while (read < sizeBytes) {
      const bytes = handle.readBytes(Math.min(1024 * 1024, sizeBytes - read));
      if (!bytes.length || bytes.length > sizeBytes - read)
        throw new Error("LOCAL_RECOVERY_FILE_CHANGED");
      digest.update(bytes);
      read += bytes.length;
      if (++chunks % 4 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (file.size !== sizeBytes) throw new Error("LOCAL_RECOVERY_FILE_CHANGED");
    return { sizeBytes, checksum: `sha256:${bytesToHex(digest.digest())}` };
  } finally {
    handle.close();
    digest.destroy();
  }
}

/** Snapshot before SQLite close/checkpoint can remove WAL/SHM. This directory is never opened as a database. */
export async function preserveCorruptDatabase(location: DatabaseLocation) {
  const target = await databaseTarget(location, true);
  const { Directory, File } = await import("expo-file-system");
  const { root, id } = await installation();
  const directory = new Directory(root, id, `isolated-${randomUUID()}`);
  directory.create({ intermediates: true });
  const originals = ["", "-wal", "-shm"].map(
    (suffix) => new File(target.directory, `${databaseName}${suffix}`),
  );
  if (!originals[0]!.exists) throw new Error("LOCAL_RECOVERY_DATABASE_MISSING");
  const present = originals.filter((file) => file.exists),
    files = [];
  for (const file of present) {
    const expected = await fingerprint(file),
      copy = new File(directory, file.name);
    await file.copy(copy);
    const actual = await fingerprint(copy),
      after = await fingerprint(file);
    if (
      JSON.stringify(expected) !== JSON.stringify(actual) ||
      JSON.stringify(expected) !== JSON.stringify(after)
    )
      throw new Error("LOCAL_RECOVERY_FILE_CHANGED");
    files.push({ name: file.name, ...expected });
  }
  if (
    originals.some(
      (file) =>
        file.exists !== present.some((entry) => entry.name === file.name),
    )
  )
    throw new Error("LOCAL_RECOVERY_FILE_CHANGED");
  const manifest = new File(directory, "snapshot.json");
  manifest.create();
  const value = JSON.stringify({
    version: 1,
    location,
    createdAt: new Date().toISOString(),
    files,
  });
  manifest.write(value);
  if ((await manifest.text()) !== value)
    throw new Error("LOCAL_RECOVERY_SNAPSHOT_UNREADABLE");
}

/** Invalid headers are isolated before even opening SQLite, which itself may clean sidecars. */
export async function preserveInvalidDatabaseHeader(
  location: DatabaseLocation,
) {
  const target = await databaseTarget(location, true);
  const { File, FileMode } = await import("expo-file-system");
  const file = new File(target.directory, databaseName);
  if (!file.exists || file.size === 0) return false;
  const handle = file.open(FileMode.ReadOnly);
  let valid = false;
  try {
    const header = handle.readBytes(16),
      expected = "SQLite format 3\0";
    valid =
      header.length === 16 &&
      header.every((byte, i) => byte === expected.charCodeAt(i));
  } finally {
    handle.close();
  }
  if (valid) return false;
  await preserveCorruptDatabase(location);
  return true;
}

export const nativeDatabaseRecoveryStorage: DatabaseRecoveryStorage = {
  readLocation,
  async prepareLocation(previous) {
    if (!same(await readLocation(), previous))
      throw new Error("LOCAL_RECOVERY_LOCATION_CHANGED");
    const { root, id } = await installation();
    const { Directory, File } = await import("expo-file-system");
    const next: DatabaseLocation = {
      version: 1,
      generation: randomUUID(),
      recoveredAt: new Date().toISOString(),
    };
    const directory = new Directory(root, id, next.generation!);
    directory.create({ intermediates: true });
    const manifest = new File(directory, "manifest.json");
    manifest.create();
    manifest.write(
      JSON.stringify(manifestSchema.parse({ version: 1, previous, next })),
    );
    // Read the durable manifest before handing its directory to SQLite.
    await databaseTarget(next, true);
    return next;
  },
  async activateLocation(previous, next) {
    const { key } = await installation();
    const { File } = await import("expo-file-system");
    const target = await databaseTarget(next, false);
    const manifest = manifestSchema.parse(
      JSON.parse(await new File(target.directory, "manifest.json").text()),
    );
    if (
      !same(manifest.previous, previous) ||
      !same(await readLocation(), previous)
    )
      throw new Error("LOCAL_RECOVERY_LOCATION_CHANGED");
    const secure = await import("expo-secure-store");
    try {
      await secure.setItemAsync(key, JSON.stringify(next));
    } catch (error) {
      // Lost acknowledgement is not permission to prepare another database.
      if (!same(await readLocation(), next)) throw error;
    }
    if (!same(await readLocation(), next))
      throw new Error("LOCAL_RECOVERY_NOT_PERSISTED");
  },
};
