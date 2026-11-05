import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  databaseTarget,
  preserveCorruptDatabase,
  preserveInvalidDatabaseHeader,
  nativeDatabaseRecoveryStorage as storage,
} from "./database-recovery-native";
import { localMigrations } from "./migrations";
import { initialDatabaseLocation } from "./database-recovery";
const native = vi.hoisted(() => ({
  root: "",
  secure: new Map<string, string>(),
  failWrite: "" as "" | "before" | "after",
  failCopy: false,
  sqliteFault: 0,
  cleared: 0,
  events: [] as string[],
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-sqlite", () => ({
  backupDatabaseAsync: async ({
    sourceDatabase,
    destDatabase,
  }: {
    sourceDatabase: { db: import("node:sqlite").DatabaseSync };
    destDatabase: { db: import("node:sqlite").DatabaseSync };
  }) => {
    const { backup } = await import("node:sqlite");
    await backup(sourceDatabase.db, destDatabase.db.location("main")!);
  },
  get defaultDatabaseDirectory() {
    return `file://${native.root}/SQLite`;
  },
  openDatabaseAsync: async (name: string, _: unknown, directory: string) => {
    const { DatabaseSync } = await import("node:sqlite"),
      { fileURLToPath } = await import("node:url"),
      { join } = await import("node:path"),
      { mkdirSync } = await import("node:fs");
    const { ReceiptTestDatabase } =
      await import("../../../../scripts/test-receipt-publication-sqlite");
    const path = fileURLToPath(directory);
    mkdirSync(path, { recursive: true });
    const db = new DatabaseSync(join(path, name)),
      adapter = new ReceiptTestDatabase(db),
      exec = adapter.execAsync.bind(adapter);
    adapter.execAsync = async (sql: string) => {
      if (native.sqliteFault)
        throw Object.assign(new Error("SQLite native fault"), {
          code: native.sqliteFault,
        });
      return exec(sql);
    };
    return Object.assign(adapter, {
      closeAsync: async () => {
        native.events.push("close");
        db.close();
      },
    });
  },
}));
vi.mock("drizzle-orm/expo-sqlite", () => ({ drizzle: () => ({}) }));
vi.mock("../auth/auth-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/auth-storage")>()),
  clearStoredSessionForDatabaseRecovery: async () => {
    native.cleared++;
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => native.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (native.failWrite === "before") throw new Error("KEYCHAIN_UNAVAILABLE");
    native.secure.set(key, value);
    if (native.failWrite === "after") throw new Error("ACK_LOST");
  },
}));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"),
    path = await import("node:path"),
    url = await import("node:url");
  const p = (parts: (string | { uri: string })[]) =>
    path.join(
      ...parts.map((v) => {
        const s = typeof v === "string" ? v : v.uri;
        return s.startsWith("file:") ? url.fileURLToPath(s) : s;
      }),
    );
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(p(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get name() {
      return path.basename(url.fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(url.fileURLToPath(this.uri)).size;
    }
    create(options?: { idempotent?: boolean; intermediates?: boolean }) {
      if (this.exists && !options?.idempotent)
        throw new Error("DIRECTORY_EXISTS");
      fs.mkdirSync(url.fileURLToPath(this.uri), {
        recursive: options?.intermediates,
      });
    }
    list() {
      return fs
        .readdirSync(url.fileURLToPath(this.uri), { withFileTypes: true })
        .map((v) =>
          v.isDirectory()
            ? new Directory(this, v.name)
            : new File(this, v.name),
        );
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(p(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get name() {
      return path.basename(url.fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(url.fileURLToPath(this.uri)).size;
    }
    create() {
      fs.writeFileSync(url.fileURLToPath(this.uri), "", { flag: "wx" });
    }
    write(value: string) {
      fs.writeFileSync(url.fileURLToPath(this.uri), value);
    }
    text() {
      return fs.promises.readFile(url.fileURLToPath(this.uri), "utf8");
    }
    async move(to: File) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (to.exists) throw new Error("FILE_EXISTS");
      fs.renameSync(url.fileURLToPath(this.uri), url.fileURLToPath(to.uri));
      this.uri = to.uri;
    }
    async copy(to: File) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (native.failCopy) throw new Error("DISK_FULL");
      native.events.push(`copy:${this.name}`);
      fs.copyFileSync(
        url.fileURLToPath(this.uri),
        url.fileURLToPath(to.uri),
        fs.constants.COPYFILE_EXCL,
      );
    }
    open() {
      const fd = fs.openSync(url.fileURLToPath(this.uri), "r");
      let offset = 0;
      return {
        readBytes: (size: number) => {
          const buffer = Buffer.alloc(size),
            n = fs.readSync(fd, buffer, 0, size, offset);
          offset += n;
          return new Uint8Array(buffer.subarray(0, n));
        },
        close: () => fs.closeSync(fd),
      };
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r" },
    Paths: {
      get document() {
        return url.pathToFileURL(native.root).href;
      },
    },
  };
});
const roots: string[] = [];
async function fixture() {
  native.root = await mkdtemp(join(tmpdir(), "fl-recovery-native-"));
  roots.push(native.root);
  native.secure.clear();
  native.failWrite = "";
  native.failCopy = false;
  native.sqliteFault = 0;
  native.cleared = 0;
  native.events = [];
  return storage.readLocation();
}
async function prepared() {
  const previous = await fixture(),
    next = await storage.prepareLocation(previous),
    target = await databaseTarget(next, true);
  const db = join(fileURLToPath(target.directory), target.name);
  await writeFile(db, "new migrated database bytes");
  return { previous, next, target, db };
}
afterEach(async () => {
  native.failWrite = "";
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("keeps the old SQLite target until a ready candidate is activated, preserves the entire old triplet and source files", async () => {
  const f = await prepared(),
    old = await databaseTarget(f.previous, false);
  await mkdir(fileURLToPath(old.directory), { recursive: true });
  const files = ["fl-copilot.db", "fl-copilot.db-wal", "fl-copilot.db-shm"];
  for (const name of files)
    await writeFile(
      join(fileURLToPath(old.directory), name),
      `original ${name}`,
    );
  await writeFile(join(native.root, "unsent-photo.jpg"), "source bytes");
  expect(await storage.readLocation()).toEqual(f.previous);
  await storage.activateLocation(f.previous, f.next);
  expect(await storage.readLocation()).toEqual(f.next);
  expect(await databaseTarget(f.next, false)).toEqual(f.target);
  for (const name of files)
    expect(
      await readFile(join(fileURLToPath(old.directory), name), "utf8"),
    ).toBe(`original ${name}`);
  expect(await readFile(join(native.root, "unsent-photo.jpg"), "utf8")).toBe(
    "source bytes",
  );
  expect(
    JSON.parse(
      await readFile(
        join(fileURLToPath(f.target.directory), "manifest.json"),
        "utf8",
      ),
    ),
  ).toEqual({ version: 1, previous: f.previous, next: f.next });
});

it("does not select a prepared but unmigrated / missing database, or overwrite a retained candidate", async () => {
  const previous = await fixture(),
    next = await storage.prepareLocation(previous);
  await expect(storage.activateLocation(previous, next)).rejects.toThrow(
    "LOCAL_RECOVERY_TARGET_UNAVAILABLE",
  );
  expect(await storage.readLocation()).toEqual(previous);
  const second = await storage.prepareLocation(previous);
  expect(second.generation).not.toBe(next.generation);
  expect(await databaseTarget(next, true)).not.toEqual(
    await databaseTarget(second, true),
  );
});

it.each(["before", "after"] as const)(
  "handles a pointer write failing %s persistence without creating another target",
  async (when) => {
    const f = await prepared();
    native.failWrite = when;
    if (when === "before")
      await expect(
        storage.activateLocation(f.previous, f.next),
      ).rejects.toThrow("KEYCHAIN_UNAVAILABLE");
    else await storage.activateLocation(f.previous, f.next);
    expect(await storage.readLocation()).toEqual(
      when === "before" ? f.previous : f.next,
    );
    expect(await readFile(f.db, "utf8")).toBe("new migrated database bytes");
  },
);

it("refuses a changed pointer, altered manifest or missing active database instead of reopening a historical copy", async () => {
  const f = await prepared(),
    other = await storage.prepareLocation(f.previous);
  const otherTarget = await databaseTarget(other, true);
  await writeFile(
    join(fileURLToPath(otherTarget.directory), otherTarget.name),
    "other db",
  );
  await storage.activateLocation(f.previous, other);
  await expect(storage.activateLocation(f.previous, f.next)).rejects.toThrow(
    "LOCAL_RECOVERY_LOCATION_CHANGED",
  );
  await rm(join(fileURLToPath(otherTarget.directory), otherTarget.name));
  await expect(databaseTarget(other, false)).rejects.toThrow(
    "LOCAL_RECOVERY_TARGET_UNAVAILABLE",
  );
  expect(await storage.readLocation()).toEqual(other);
  await writeFile(
    join(fileURLToPath(f.target.directory), "manifest.json"),
    JSON.stringify({ version: 1, previous: f.previous, next: other }),
  );
  await expect(databaseTarget(f.next, true)).rejects.toThrow(
    "LOCAL_RECOVERY_TARGET_UNAVAILABLE",
  );
});

it("fails closed on damaged route/installation metadata or a lost Keychain pointer", async () => {
  const f = await prepared(),
    key = [...native.secure.keys()][0]!;
  native.secure.set(key, "broken json");
  await expect(storage.readLocation()).rejects.toThrow();
  native.secure.delete(key);
  await expect(storage.readLocation()).rejects.toThrow(
    "LOCAL_RECOVERY_POINTER_UNAVAILABLE",
  );
  await rm(join(native.root, "database-recovery", "installation.json"));
  await expect(storage.readLocation()).rejects.toThrow(
    "LOCAL_RECOVERY_INSTALLATION_UNAVAILABLE",
  );
  expect(await readFile(f.db, "utf8")).toBe("new migrated database bytes");
});

it("binds route pointers to this app installation, not stale iOS Keychain entries retained after uninstall", async () => {
  const f = await prepared();
  await storage.activateLocation(f.previous, f.next);
  const oldKeys = [...native.secure.keys()];
  native.root = await mkdtemp(join(tmpdir(), "fl-reinstalled-container-"));
  roots.push(native.root);
  expect(await storage.readLocation()).toEqual(initialDatabaseLocation);
  expect(native.secure.size).toBe(2);
  expect(
    [...native.secure.keys()].filter((k) => !oldKeys.includes(k)),
  ).toHaveLength(1);
  expect(
    (await databaseTarget(initialDatabaseLocation, true)).directory,
  ).toContain(native.root);
});

it("rejects path traversal and timestamp/identity mismatches before accessing a candidate", async () => {
  await fixture();
  for (const location of [
    {
      version: 1,
      generation: "../../other-account",
      recoveredAt: "2026-10-20T21:00:00.000Z",
    },
    { version: 1, generation: null, recoveredAt: "2026-10-20T21:00:00.000Z" },
  ])
    await expect(databaseTarget(location as never, true)).rejects.toThrow();
  const entries = await readdir(join(native.root, "database-recovery"));
  expect(entries).toEqual(["installation.json"]);
});

it("snapshots the complete corrupt triplet with byte proofs before opening or closing SQLite", async () => {
  const location = await fixture(),
    target = await databaseTarget(location, true),
    directory = fileURLToPath(target.directory);
  await mkdir(directory);
  const originals = ["fl-copilot.db", "fl-copilot.db-wal", "fl-copilot.db-shm"];
  for (const file of originals)
    await writeFile(join(directory, file), `opaque corrupt ${file}`);
  expect(await preserveInvalidDatabaseHeader(location)).toBe(true);
  const snapshots = (
    await readdir(join(native.root, "database-recovery"), { recursive: true })
  ).filter((p) => p.endsWith("snapshot.json"));
  expect(snapshots).toHaveLength(1);
  const snapshot = JSON.parse(
    await readFile(
      join(native.root, "database-recovery", snapshots[0]!),
      "utf8",
    ),
  );
  expect(snapshot.files).toHaveLength(3);
  for (const file of originals) {
    const archived = join(
      native.root,
      "database-recovery",
      snapshots[0]!.replace("snapshot.json", file),
    );
    expect(await readFile(archived)).toEqual(
      await readFile(join(directory, file)),
    );
    expect(
      snapshot.files.find((v: { name: string }) => v.name === file).checksum,
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
  }
  expect(native.events).toEqual(originals.map((name) => `copy:${name}`));
});

it("does not certify a partial snapshot when preservation fails", async () => {
  const location = await fixture(),
    target = await databaseTarget(location, true);
  await mkdir(fileURLToPath(target.directory));
  await writeFile(
    join(fileURLToPath(target.directory), target.name),
    "corrupt",
  );
  native.failCopy = true;
  await expect(preserveCorruptDatabase(location)).rejects.toThrow("DISK_FULL");
  expect(
    (
      await readdir(join(native.root, "database-recovery"), { recursive: true })
    ).some((p) => p.endsWith("snapshot.json")),
  ).toBe(false);
  expect(await storage.readLocation()).toEqual(location);
});

it("runs the real startup client through preserved header corruption, confirmed recovery, credential clearing and a reopened current schema", async () => {
  const location = await fixture(),
    target = await databaseTarget(location, true);
  await mkdir(fileURLToPath(target.directory));
  await writeFile(
    join(fileURLToPath(target.directory), target.name),
    "unreadable SQLite header",
  );
  await writeFile(
    join(fileURLToPath(target.directory), target.name + "-wal"),
    "unsent WAL",
  );
  await vi.resetModules();
  const client = await import("./client");
  await expect(client.initializeLocalDatabase()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  expect(native.events).toEqual([
    "copy:fl-copilot.db",
    "copy:fl-copilot.db-wal",
  ]);
  expect(native.cleared).toBe(0);
  const db = await client.recoverLocalDatabase();
  expect(db.schemaVersion).toBe(localMigrations.length);
  expect(db.recovery).toBeDefined();
  expect(native.cleared).toBe(1);
  expect(await client.initializeLocalDatabase()).toBe(db);
  await db.sqlite.closeAsync();
  expect(
    await readFile(
      join(fileURLToPath(target.directory), target.name + "-wal"),
      "utf8",
    ),
  ).toBe("unsent WAL");
});

it("retains a corrupt live handle when its snapshot fails; retry preserves before close and only then permits recovery", async () => {
  await fixture();
  await vi.resetModules();
  native.sqliteFault = 11;
  native.failCopy = true;
  const client = await import("./client");
  await expect(client.initializeLocalDatabase()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
  expect(native.events).not.toContain("close");
  await expect(client.recoverLocalDatabase()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
  native.failCopy = false;
  await expect(client.initializeLocalDatabase()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  expect(native.events.indexOf("copy:fl-copilot.db")).toBeLessThan(
    native.events.indexOf("close"),
  );
  native.sqliteFault = 0;
  const db = await client.recoverLocalDatabase();
  await db.sqlite.closeAsync();
});

// These use real file-backed SQLite (including its online backup), with only native FS/Keychain ports replaced.
async function copyFixture() {
  const location = await fixture(),
    { randomUUID } = await import("node:crypto");
  const { nativeReceiptPublicationFixture } =
    await import("../../../../scripts/test-receipt-publication-sqlite");
  const target = await databaseTarget(location, true);
  await mkdir(fileURLToPath(target.directory), { recursive: true });
  const f = await nativeReceiptPublicationFixture(
    join(fileURLToPath(target.directory), target.name),
  );
  await f.a.runAsync(
    "INSERT INTO app_metadata(key,value,updated_at) VALUES('device_id',?,?)",
    f.f.chat.deviceId,
    new Date().toISOString(),
  );
  const ownerId = f.f.chat.ownerId,
    storeId = f.f.chat.storeId,
    deviceId = f.f.chat.deviceId;
  native.secure.set(
    "auth.session-marker",
    JSON.stringify({
      user: {
        id: ownerId,
        email: "private@example.test",
        displayName: "Private",
      },
      stores: [{ storeId, name: "Private store", role: "MANAGER" }],
    }),
  );
  const { serializeLocalWrites } = await import("./serialized-writes");
  const exclusive = f.a.withExclusiveTransactionAsync.bind(f.a);
  const { ReceiptTestDatabase } =
    await import("../../../../scripts/test-receipt-publication-sqlite");
  f.a.withExclusiveTransactionAsync = (action) =>
    exclusive(() => action(new ReceiptTestDatabase(f.db)));
  serializeLocalWrites(f.a as unknown as import("expo-sqlite").SQLiteDatabase);
  return { ...f, location, ownerId, storeId, deviceId, randomUUID };
}
async function copies() {
  return import("./local-copies-native");
}
it("backs up WAL-committed observations, drafts and exact Outbox UUID/order/attempts; restores after restart without overwriting the current generation", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    await f.a.runAsync(
      "UPDATE sync_outbox SET status='SYNCING',attempt_count=7,last_error_code='NETWORK_UNAVAILABLE' WHERE local_sequence=1",
    );
    const before = await f.a.getAllAsync(
      "SELECT * FROM sync_outbox ORDER BY local_sequence",
    );
    const saved = await api.createLocalCopy(
      f.a as never,
      f.deviceId,
      f.ownerId,
      f.storeId,
      () => {},
    );
    // Later writes are kept in the retained old generation, never silently discarded.
    await f.a.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES('later_draft','keep me',?)",
      new Date().toISOString(),
    );
    const ready = await api.prepareLocalCopy(
      saved,
      f.ownerId,
      f.storeId,
      () => {},
    );
    expect(await storage.readLocation()).toEqual(f.location);
    expect(
      await f.a.getFirstAsync(
        "SELECT value FROM app_metadata WHERE key='later_draft'",
      ),
    ).toEqual({ value: "keep me" });
    await api.activatePreparedLocalCopy(ready);
    await api.activatePreparedLocalCopy(ready); // Lost ACK, same candidate.
    const { openDatabaseAsync } = await import("expo-sqlite"),
      target = await databaseTarget(await storage.readLocation(), false);
    const reopened = await openDatabaseAsync(
      target.name,
      { useNewConnection: true },
      target.directory,
    );
    try {
      expect(
        await reopened.getAllAsync(
          "SELECT * FROM sync_outbox ORDER BY local_sequence",
        ),
      ).toEqual(before);
      expect(
        await reopened.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key='device_id'",
        ),
      ).toEqual({ value: f.deviceId });
      expect(
        await reopened.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key='later_draft'",
        ),
      ).toBeNull();
      expect(
        await reopened.getFirstAsync(
          "SELECT COUNT(*) AS n FROM waste_receipts",
        ),
      ).toEqual({ n: 1 });
      expect(await api.restoredDatabaseOwner(ready.next)).toBe(f.ownerId);
    } finally {
      await reopened.closeAsync();
    }
    const refs = await api.listLocalCopies(f.ownerId, f.storeId);
    const old = refs.find((v) => v.kind === "previous")!;
    expect(old.location).toEqual(f.location);
    const back = await api.prepareLocalCopy(
      old,
      f.ownerId,
      f.storeId,
      () => {},
    );
    expect(back.deviceId).toBe(f.deviceId);
    const oldTarget = await databaseTarget(back.next, false);
    const prior = await openDatabaseAsync(
      oldTarget.name,
      { useNewConnection: true },
      oldTarget.directory,
    );
    try {
      expect(
        await prior.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key='later_draft'",
        ),
      ).toEqual({ value: "keep me" });
    } finally {
      await prior.closeAsync();
    }
  } finally {
    f.db.close();
  }
});
const mongoUri = process.env.TEST_MONGODB_URI;
it
  .skipIf(!mongoUri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")
  .each(["before-commit", "after-commit"])(
  "restores in-flight business commands after %s network loss and synchronizes through the real Mongo journal without duplicate mutations",
  async (loss) => {
    const f = await copyFixture(),
      api = await copies(),
      { createMongoDatabase } = await import("../../../api/src/database/mongo"),
      { parseEnvironment } = await import("../../../api/src/config"),
      { createMongoSyncPushService } =
        await import("../../../api/src/sync/push-service"),
      { createMongoSyncPullService } =
        await import("../../../api/src/sync/pull-service"),
      { createMongoSyncBootstrapService } =
        await import("../../../api/src/sync/bootstrap-service"),
      { MobileSyncService } = await import("../sync/sync-service"),
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: mongoUri,
          MONGODB_DATABASE: `flc_recovery_replay_${f.randomUUID().replaceAll("-", "")}`,
        }),
      );
    let release!: () => void, committed!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        committed = resolve;
      }),
      requests: import("@fl-copilot/sync-contracts").SyncPushRequest[] = [];
    const pushing = createMongoSyncPushService(database),
      pulling = createMongoSyncPullService(database),
      boot = createMongoSyncBootstrapService(database),
      makeService = (
        db: import("../sync/sync-service").SyncDatabase,
        push: import("../sync/sync-service").SyncTransport["push"],
      ) =>
        new MobileSyncService(
          db,
          {
            push,
            pull: (storeId, cursor) =>
              pulling.pull(storeId, { cursor, limit: 500 }),
            bootstrap: (storeId) =>
              boot.bootstrap(
                {
                  storeId,
                  userId: f.ownerId,
                  deviceId: f.deviceId,
                  storeName: "Isolated recovery test",
                  role: "MANAGER",
                  sessionId: f.randomUUID(),
                },
                { rawObservationDays: 90 },
              ),
          },
          {
            appVersion: "test",
            deviceId: f.deviceId,
            copilotOwnerId: f.ownerId,
            maxRetries: 0,
          },
        );
    let first: Promise<void> | undefined;
    try {
      const remote = await database.getDb();
      const sending = makeService(f.a, async (request) => {
        requests.push(request);
        if (loss === "after-commit") {
          const result = await pushing.push(request, f.randomUUID(), f.ownerId);
          expect(result.results.map((r) => r.status)).toEqual(
            request.commands.map(() => "APPLIED"),
          );
        }
        committed();
        await gate;
        throw Error("ACK_NOT_RECEIVED");
      }).push(f.storeId);
      first = expect(sending).rejects.toThrow("ACK_NOT_RECEIVED");
      await Promise.race([
        started,
        first.then(() => {
          throw Error("PUSH_ENDED_BEFORE_SNAPSHOT");
        }),
      ]);
      const checkpoint = await f.a.getAllAsync<{
        command_id: string;
        payload_json: string;
        status: string;
      }>("SELECT * FROM sync_outbox ORDER BY local_sequence");
      expect(checkpoint).toHaveLength(3);
      expect(checkpoint.map((c) => c.status)).toEqual([
        "SYNCING",
        "SYNCING",
        "SYNCING",
      ]);
      const saved = await api.createLocalCopy(
          f.a as never,
          f.deviceId,
          f.ownerId,
          f.storeId,
          () => {},
        ),
        ready = await api.prepareLocalCopy(
          saved,
          f.ownerId,
          f.storeId,
          () => {},
        );
      release();
      await first;
      await api.activatePreparedLocalCopy(ready);
      expect(await api.restoredDatabaseOwner(ready.next)).toBe(f.ownerId);
      const target = await databaseTarget(await storage.readLocation(), false),
        { openDatabaseAsync } = await import("expo-sqlite"),
        restored = await openDatabaseAsync(
          target.name,
          { useNewConnection: true },
          target.directory,
        );
      try {
        expect(
          await restored.getAllAsync(
            "SELECT * FROM sync_outbox ORDER BY local_sequence",
          ),
        ).toEqual(checkpoint);
        const replayResults: string[] = [],
          service = makeService(restored as never, async (request) => {
            requests.push(request);
            const result = await pushing.push(
              request,
              f.randomUUID(),
              f.ownerId,
            );
            replayResults.push(...result.results.map((r) => r.status));
            return result;
          });
        expect(await service.sync(f.storeId)).toMatchObject({
          pushed: 3,
          conflicts: 0,
          failed: 0,
        });
        expect(replayResults).toEqual(
          checkpoint.map(() =>
            loss === "after-commit" ? "ALREADY_APPLIED" : "APPLIED",
          ),
        );
        expect(requests).toHaveLength(2);
        expect(requests[1]!.commands).toEqual(requests[0]!.commands);
        expect(
          await restored.getAllAsync(
            "SELECT command_id,payload_json FROM sync_outbox ORDER BY local_sequence",
          ),
        ).toEqual(
          checkpoint.map(({ command_id, payload_json }) => ({
            command_id,
            payload_json,
          })),
        );
        expect(
          await restored.getAllAsync(
            "SELECT status,attempt_count FROM sync_outbox ORDER BY local_sequence",
          ),
        ).toEqual(
          checkpoint.map(() => ({ status: "ACKNOWLEDGED", attempt_count: 2 })),
        );
        expect(
          await remote
            .collection("processedCommands")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);
        expect(
          await remote
            .collection("syncChanges")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);
        expect(
          await remote
            .collection("products")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(1);
        const product = await remote
          .collection<
            import("../../../api/src/products/product-master").ProductDocument
          >("products")
          .findOne({ _id: f.product.id, storeId: f.storeId });
        expect(product).toMatchObject({
          _id: f.product.id,
          label: f.product.label,
          version: 1,
        });
        expect(await service.sync(f.storeId)).toMatchObject({
          pushed: 0,
          conflicts: 0,
          failed: 0,
        });
        expect(requests).toHaveLength(2);
        expect(
          await remote
            .collection("syncChanges")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);
        // The retained prior generation still has its own unacknowledged state.
        expect(
          (
            await f.a.getAllAsync<{ status: string }>(
              "SELECT status FROM sync_outbox",
            )
          ).map((c) => c.status),
        ).toEqual(["PENDING", "PENDING", "PENDING"]);
      } finally {
        await restored.closeAsync();
      }
      const previous = (await api.listLocalCopies(f.ownerId, f.storeId)).find(
        (ref) => ref.kind === "previous",
      )!;
      expect(previous.location).toEqual(f.location);
      const back = await api.prepareLocalCopy(
        previous,
        f.ownerId,
        f.storeId,
        () => {},
      );
      await api.activatePreparedLocalCopy(back);
      const previousTarget = await databaseTarget(
          await storage.readLocation(),
          false,
        ),
        resumed = await openDatabaseAsync(
          previousTarget.name,
          { useNewConnection: true },
          previousTarget.directory,
        );
      try {
        const results: string[] = [];
        expect(
          await makeService(resumed as never, async (request) => {
            requests.push(request);
            const response = await pushing.push(
              request,
              f.randomUUID(),
              f.ownerId,
            );
            results.push(...response.results.map((r) => r.status));
            return response;
          }).sync(f.storeId),
        ).toMatchObject({ pushed: 3, conflicts: 0, failed: 0 });
        expect(results).toEqual([
          "ALREADY_APPLIED",
          "ALREADY_APPLIED",
          "ALREADY_APPLIED",
        ]);
        expect(requests).toHaveLength(3);
        expect(requests[2]!.commands).toEqual(requests[0]!.commands);
        expect(
          await remote
            .collection("processedCommands")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);
        expect(
          await remote
            .collection("syncChanges")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);
      } finally {
        await resumed.closeAsync();
      }
    } finally {
      release();
      await first?.catch(() => undefined);
      f.db.close();
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    }
  },
  60000,
);

it("queues the snapshot behind the existing writer, so no half-committed aggregate or Outbox is copied", async () => {
  const f = await copyFixture(),
    api = await copies();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const writing = f.a.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      "UPDATE products SET label='Committed product' WHERE id=?",
      f.f.p.observations[0]!.productId,
    );
    await gate;
    await tx.runAsync(
      "UPDATE sync_outbox SET attempt_count=17 WHERE local_sequence=1",
    );
  });
  const creating = api.createLocalCopy(
    f.a as never,
    f.deviceId,
    f.ownerId,
    f.storeId,
    () => {},
  );
  await new Promise<void>((r) => setTimeout(r, 20));
  release();
  try {
    await writing;
    const ref = await creating;
    const ready = await api.prepareLocalCopy(
      ref,
      f.ownerId,
      f.storeId,
      () => {},
    );
    const target = await databaseTarget(ready.next, false),
      { openDatabaseAsync } = await import("expo-sqlite");
    const db = await openDatabaseAsync(
      target.name,
      undefined,
      target.directory,
    );
    try {
      expect(
        await db.getFirstAsync(
          "SELECT label FROM products WHERE id=?",
          f.f.p.observations[0]!.productId,
        ),
      ).toEqual({ label: "Committed product" });
      expect(
        await db.getFirstAsync(
          "SELECT attempt_count FROM sync_outbox WHERE local_sequence=1",
        ),
      ).toEqual({ attempt_count: 17 });
    } finally {
      await db.closeAsync();
    }
  } finally {
    f.db.close();
  }
});
it("refuses a changed copy, foreign account/store, stale screen and future schema without activating or removing originals", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    const ref = await api.createLocalCopy(
      f.a as never,
      f.deviceId,
      f.ownerId,
      f.storeId,
      () => {},
    );
    await expect(
      api.listLocalCopies(f.randomUUID(), f.storeId),
    ).rejects.toThrow("compte d’origine");
    await expect(
      api.prepareLocalCopy(ref, f.ownerId, f.randomUUID(), () => {}),
    ).rejects.toThrow("compte d’origine");
    await expect(
      api.prepareLocalCopy(ref, f.ownerId, f.storeId, () => {
        throw Error("STALE");
      }),
    ).rejects.toThrow("STALE");
    const { databaseInstallation } = await import("./database-recovery-native"),
      installation = await databaseInstallation();
    const snapshot = join(
      fileURLToPath(installation.root.uri),
      installation.id,
      ref.id,
      "fl-copilot.db",
    );
    await writeFile(snapshot, "modified");
    await expect(
      api.prepareLocalCopy(ref, f.ownerId, f.storeId, () => {}),
    ).rejects.toThrow("copie ou la session a changé");
    await f.a.execAsync("PRAGMA user_version=99999");
    await expect(
      api.createLocalCopy(
        f.a as never,
        f.deviceId,
        f.ownerId,
        f.storeId,
        () => {},
      ),
    ).rejects.toThrow("ne peut pas être reprise en sécurité");
    expect(await storage.readLocation()).toEqual(f.location);
    expect(await readFile(snapshot, "utf8")).toBe("modified");
  } finally {
    f.db.close();
  }
});
it("checks the prepared bytes again at activation and keeps a new candidate after Keychain failure", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    const ref = await api.createLocalCopy(
      f.a as never,
      f.deviceId,
      f.ownerId,
      f.storeId,
      () => {},
    );
    const ready = await api.prepareLocalCopy(
      ref,
      f.ownerId,
      f.storeId,
      () => {},
    );
    native.failWrite = "before";
    await expect(api.activatePreparedLocalCopy(ready)).rejects.toThrow(
      "KEYCHAIN_UNAVAILABLE",
    );
    expect(await storage.readLocation()).toEqual(f.location);
    native.failWrite = "";
    const target = await databaseTarget(ready.next, false);
    await writeFile(
      join(fileURLToPath(target.directory), target.name),
      "tampered",
    );
    await expect(api.activatePreparedLocalCopy(ready)).rejects.toThrow(
      "copie ou la session a changé",
    );
    expect(await storage.readLocation()).toEqual(f.location);
  } finally {
    f.db.close();
  }
});
it("verifies isolated forensic bytes on a clone, including WAL, and never opens or mutates the isolated original", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    await preserveCorruptDatabase(f.location); // Controlled healthy triplet simulates a readable isolated copy.
    const next = await storage.prepareLocation(f.location),
      target = await databaseTarget(next, true);
    await writeFile(
      join(fileURLToPath(target.directory), target.name),
      "placeholder",
    );
    const { preserveDatabaseRecoveryOwner, currentDatabaseOwner } =
      await import("../auth/auth-storage");
    await preserveDatabaseRecoveryOwner(
      next.generation!,
      await currentDatabaseOwner(),
    );
    await storage.activateLocation(f.location, next);
    const refs = await api.listLocalCopies(f.ownerId, f.storeId),
      isolated = refs.find((v) => v.kind === "isolated")!;
    expect(isolated).toBeDefined();
    const ready = await api.prepareLocalCopy(
      isolated,
      f.ownerId,
      f.storeId,
      () => {},
    );
    expect(ready.deviceId).toBe(f.deviceId);
    // A second verification sees identical byte hashes on the immutable original triplet.
    const again = await api.prepareLocalCopy(
      isolated,
      f.ownerId,
      f.storeId,
      () => {},
    );
    expect(again.deviceId).toBe(f.deviceId);
    expect(await storage.readLocation()).toEqual(next);
  } finally {
    f.db.close();
  }
});
it("retains a corrupt isolated triplet unchanged and refuses recovery instead of manufacturing a device or replaying damaged data", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    const next = await storage.prepareLocation(f.location),
      target = await databaseTarget(next, true);
    await writeFile(
      join(fileURLToPath(target.directory), target.name),
      "new database placeholder",
    );
    const old = await databaseTarget(f.location, false);
    // Close first: corruption is manufactured only on the test fixture, never production data.
    f.db.close();
    const bytes = Buffer.from("corrupt SQLite original");
    await writeFile(join(fileURLToPath(old.directory), old.name), bytes);
    await preserveCorruptDatabase(f.location);
    const { preserveDatabaseRecoveryOwner, currentDatabaseOwner } =
      await import("../auth/auth-storage");
    await preserveDatabaseRecoveryOwner(
      next.generation!,
      await currentDatabaseOwner(),
    );
    await storage.activateLocation(f.location, next);
    const ref = (await api.listLocalCopies(f.ownerId, f.storeId)).find(
      (v) => v.kind === "isolated",
    )!;
    const installation = await (
      await import("./database-recovery-native")
    ).databaseInstallation();
    const preserved = join(
      fileURLToPath(installation.root.uri),
      installation.id,
      ref.id,
      old.name,
    );
    await expect(
      api.prepareLocalCopy(ref, f.ownerId, f.storeId, () => {}),
    ).rejects.toThrow();
    expect(await readFile(preserved)).toEqual(bytes);
    expect(await storage.readLocation()).toEqual(next);
  } finally {
    try {
      f.db.close();
    } catch {
      /* Test connection already closed before corrupting its file. */
    }
  }
});
it("keeps an independent owned backup available when an older retained generation manifest becomes unreadable", async () => {
  const f = await copyFixture(),
    api = await copies();
  try {
    const ref = await api.createLocalCopy(
      f.a as never,
      f.deviceId,
      f.ownerId,
      f.storeId,
      () => {},
    );
    const first = await api.prepareLocalCopy(
      ref,
      f.ownerId,
      f.storeId,
      () => {},
    );
    await api.activatePreparedLocalCopy(first);
    const olderTarget = await databaseTarget(first.next, false);
    const second = await api.prepareLocalCopy(
      ref,
      f.ownerId,
      f.storeId,
      () => {},
    );
    await api.activatePreparedLocalCopy(second);
    await writeFile(
      join(fileURLToPath(olderTarget.directory), "manifest.json"),
      "unreadable old manifest",
    );
    expect(
      (await api.listLocalCopies(f.ownerId, f.storeId)).some(
        (v) => v.kind === "backup" && v.id === ref.id,
      ),
    ).toBe(true);
    const prepared = await api.prepareLocalCopy(
      ref,
      f.ownerId,
      f.storeId,
      () => {},
    );
    expect(prepared.deviceId).toBe(f.deviceId);
    expect(await storage.readLocation()).toEqual(second.next);
  } finally {
    f.db.close();
  }
});
