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
vi.mock("expo-sqlite", () => ({
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
vi.mock("../auth/auth-storage", () => ({
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
    move(to: File) {
      if (to.exists) throw new Error("FILE_EXISTS");
      fs.renameSync(url.fileURLToPath(this.uri), url.fileURLToPath(to.uri));
      this.uri = to.uri;
    }
    copy(to: File) {
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
  expect(db.schemaVersion).toBe(60);
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
