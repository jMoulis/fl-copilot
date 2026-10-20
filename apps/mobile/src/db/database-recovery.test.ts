import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  DatabaseStartupError,
  LocalDatabaseLifecycle,
  initialDatabaseLocation,
  isSQLiteCorruption,
  type DatabaseLocation,
} from "./database-recovery";
import { runLocalMigrations } from "./migrations";
import { getOrCreateDeviceId } from "./device-identity";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { applyBootstrap } from "../sync/apply-bootstrap";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";

const corruption = () =>
  new Error(
    "FunctionCallException → Caused by: SQLiteErrorException: Error code 26: file is not a database",
  );
const nextLocation = (): DatabaseLocation => ({
  version: 1,
  generation: randomUUID(),
  recoveredAt: "2026-10-20T21:00:00.000Z",
});
function ports() {
  let location = initialDatabaseLocation;
  const next = nextLocation();
  const value = { token: randomUUID() };
  return {
    value,
    next,
    storage: {
      readLocation: vi.fn(async () => location),
      prepareLocation: vi.fn(async () => next),
      activateLocation: vi.fn(
        async (_previous: DatabaseLocation, n: DatabaseLocation) => {
          location = n;
        },
      ),
    },
    open: vi.fn(async (l: DatabaseLocation) => {
      if (!l.generation) throw corruption();
      return value;
    }),
    close: vi.fn(async () => {}),
    clearAuthentication: vi.fn(async () => {}),
  };
}

it.each([
  [new Error("database is locked"), false],
  [{ code: 5, message: "database is locked" }, false],
  [{ code: 13 }, false],
  [{ code: 10 }, false],
  [new Error("Newer database schema is unsupported"), false],
  [new Error("Migration 42 failed"), false],
  [new Error("SQL syntax error"), false],
  [new Error("database disk image is malformed"), true],
  [corruption(), true],
  [{ code: "SQLITE_CORRUPT" }, true],
  [{ code: 267 }, true],
  [{ cause: { cause: { code: 26 } } }, true],
])("restricts corruption eligibility (%j)", (error, expected) => {
  expect(isSQLiteCorruption(error)).toBe(expected);
});

it("bounds cyclic native error chains and refuses strings / lookalike business errors", () => {
  const error = { cause: null as unknown };
  error.cause = error;
  expect(isSQLiteCorruption(error)).toBe(false);
  expect(isSQLiteCorruption("SQLITE_CORRUPT")).toBe(false);
  expect(isSQLiteCorruption(new Error("Le document est corrompu"))).toBe(false);
});

it("does not touch storage/authentication on a healthy startup or an unconfirmed failure", async () => {
  const p = ports(),
    lifecycle = new LocalDatabaseLifecycle(p);
  await expect(lifecycle.recover()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
  await expect(lifecycle.initialize()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  expect(p.storage.prepareLocation).not.toHaveBeenCalled();
  expect(p.clearAuthentication).not.toHaveBeenCalled();
  p.open.mockResolvedValue(p.value);
  expect(await lifecycle.initialize()).toBe(p.value);
  expect(await lifecycle.initialize()).toBe(p.value);
  expect(p.open).toHaveBeenCalledTimes(2);
  await expect(lifecycle.recover()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
});

it("refuses recovery on locked/full/IO/migration errors, including an unclosed corrupted connection", async () => {
  for (const error of [
    new Error("database is locked"),
    { code: 13 },
    { code: 10 },
    new Error("Migration failed"),
    new DatabaseStartupError("UNAVAILABLE", { cause: corruption() }),
  ]) {
    const p = ports();
    p.open.mockRejectedValue(error);
    const lifecycle = new LocalDatabaseLifecycle(p);
    await expect(lifecycle.initialize()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    await expect(lifecycle.recover()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(p.storage.prepareLocation).not.toHaveBeenCalled();
  }
});

it("coalesces rapid confirmations and concurrent startup; migrates/closes before auth clearing and pointer activation", async () => {
  const p = ports(),
    lifecycle = new LocalDatabaseLifecycle(p);
  await expect(lifecycle.initialize()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  const a = lifecycle.recover(),
    b = lifecycle.recover(),
    c = lifecycle.initialize();
  expect(a).toBe(b);
  expect(b).toBe(c);
  expect(await a).toBe(p.value);
  expect(p.storage.prepareLocation).toHaveBeenCalledOnce();
  expect(p.close).toHaveBeenCalledOnce();
  expect(p.clearAuthentication).toHaveBeenCalledOnce();
  expect(p.storage.activateLocation).toHaveBeenCalledExactlyOnceWith(
    initialDatabaseLocation,
    p.next,
  );
  expect(p.close.mock.invocationCallOrder[0]).toBeLessThan(
    p.clearAuthentication.mock.invocationCallOrder[0]!,
  );
  expect(p.clearAuthentication.mock.invocationCallOrder[0]).toBeLessThan(
    p.storage.activateLocation.mock.invocationCallOrder[0]!,
  );
  expect(await lifecycle.initialize()).toBe(p.value);
  expect(p.open).toHaveBeenCalledTimes(3);
});

it.each(["prepare", "migration", "close", "auth", "pointer"] as const)(
  "keeps the old active location after a failure at %s",
  async (boundary) => {
    const p = ports(),
      lifecycle = new LocalDatabaseLifecycle(p);
    await expect(lifecycle.initialize()).rejects.toMatchObject({
      kind: "CORRUPTION",
    });
    const failure = new Error("INTERRUPTED_" + boundary);
    if (boundary === "prepare")
      p.storage.prepareLocation.mockRejectedValue(failure);
    if (boundary === "migration") p.open.mockRejectedValue(failure);
    if (boundary === "close") p.close.mockRejectedValue(failure);
    if (boundary === "auth") p.clearAuthentication.mockRejectedValue(failure);
    if (boundary === "pointer")
      p.storage.activateLocation.mockRejectedValue(failure);
    await expect(lifecycle.recover()).rejects.toThrow(failure.message);
    expect(await p.storage.readLocation()).toEqual(initialDatabaseLocation);
    if (["prepare", "migration", "close"].includes(boundary))
      expect(p.clearAuthentication).not.toHaveBeenCalled();
    if (boundary !== "pointer")
      expect(p.storage.activateLocation).not.toHaveBeenCalled();
  },
);

it("does not fall back to an older database after the pointer was committed but reopening fails", async () => {
  const p = ports(),
    lifecycle = new LocalDatabaseLifecycle(p);
  await expect(lifecycle.initialize()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  p.open
    .mockResolvedValueOnce(p.value)
    .mockRejectedValueOnce(new Error("IO_ERROR"));
  await expect(lifecycle.recover()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
  expect(await p.storage.readLocation()).toEqual(p.next);
  p.open.mockResolvedValue(p.value);
  expect(await new LocalDatabaseLifecycle(p).initialize()).toBe(p.value);
  expect(p.open.mock.calls.at(-1)?.[0]).toEqual(p.next);
});

it("invalidates a past corruption diagnosis as soon as a normal retry starts", async () => {
  const p = ports(),
    lifecycle = new LocalDatabaseLifecycle(p);
  await expect(lifecycle.initialize()).rejects.toMatchObject({
    kind: "CORRUPTION",
  });
  let release!: () => void;
  p.open.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return p.value;
  });
  const retry = lifecycle.initialize();
  await expect(lifecycle.recover()).rejects.toMatchObject({
    kind: "UNAVAILABLE",
  });
  release();
  await retry;
  expect(p.storage.prepareLocation).not.toHaveBeenCalled();
});

it("isolates a genuinely unreadable SQLite file, preserves its bytes/originals, then bootstraps only the new database after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "fl-database-corruption-")),
    path = join(root, "fl-copilot.db"),
    original = join(root, "unsent-receipt.jpg"),
    bytes = Buffer.from([0, 1, 255, 42]),
    oldId = randomUUID(),
    newId = randomUUID(),
    source = new DatabaseSync(path),
    old = new ReceiptTestDatabase(source);
  let active = initialDatabaseLocation;
  const close = vi.fn(
    async (db: { adapter: ReceiptTestDatabase; deviceId: string }) =>
      db.adapter.db.close(),
  );
  const clearAuthentication = vi.fn(async () => {});
  try {
    await runLocalMigrations(old);
    await getOrCreateDeviceId(old, () => oldId);
    source.close();
    const corrupted = await readFile(path);
    corrupted.fill(0, 0, 16);
    await writeFile(path, corrupted);
    await writeFile(original, bytes);
    const before = await Promise.all([path, original].map((v) => readFile(v)));
    const storage = {
      readLocation: async () => active,
      prepareLocation: async () => {
        const n = nextLocation();
        await mkdir(join(root, n.generation!));
        return n;
      },
      activateLocation: async (_: DatabaseLocation, n: DatabaseLocation) => {
        active = n;
      },
    };
    const open = async (location: DatabaseLocation) => {
      const db = new DatabaseSync(
        location.generation
          ? join(root, location.generation, "fl-copilot.db")
          : path,
      );
      try {
        const adapter = new ReceiptTestDatabase(db);
        await runLocalMigrations(adapter);
        const deviceId = await getOrCreateDeviceId(adapter, () => newId);
        return { adapter, deviceId };
      } catch (error) {
        db.close();
        throw error;
      }
    };
    const lifecycle = new LocalDatabaseLifecycle({
      storage,
      open,
      close,
      clearAuthentication,
    });
    await expect(lifecycle.initialize()).rejects.toMatchObject({
      kind: "CORRUPTION",
    });
    const recovered = await lifecycle.recover();
    expect(recovered.deviceId).toBe(newId);
    expect(newId).not.toBe(oldId);
    expect(
      recovered.adapter.db.prepare("SELECT count(*) n FROM sync_outbox").get(),
    ).toMatchObject({ n: 0 });
    await close(recovered);
    const restarted = await new LocalDatabaseLifecycle({
      storage,
      open,
      close,
      clearAuthentication,
    }).initialize();
    const storeId = randomUUID(),
      entityId = randomUUID();
    const snapshot: BootstrapResponse = {
      protocolVersion: 1,
      store: { id: storeId, name: "Recovery test", role: "MANAGER" },
      snapshotRevision: "recovered-1",
      cursor: "cursor-recovered-1",
      historyPolicy: { rawObservationDays: 90 },
      entities: {
        syncTestEntities: [
          {
            id: entityId,
            storeId,
            label: "Donnée déjà synchronisée",
            remoteVersion: 1,
            createdAt: "2026-10-20T20:00:00.000Z",
            updatedAt: "2026-10-20T20:00:00.000Z",
          },
        ],
        products: [],
        productIdentifiers: [],
        productAliases: [],
        needUnits: [],
        needMemberships: [],
        productSubstitutions: [],
        salesObservations: [],
        wasteObservations: [],
        commercialOperations: [],
        offers: [],
        marketSignals: [],
        executionInstructions: [],
        storeEvents: [],
        productDailyPerformance: [],
        departmentDailyPerformance: [],
        recommendations: [],
        decisions: [],
        actionExecutions: [],
      },
      serverTime: "2026-10-20T21:00:00.000Z",
    };
    await applyBootstrap(restarted.adapter, storeId, snapshot);
    expect(
      restarted.adapter.db
        .prepare("SELECT label FROM sync_test_entities WHERE id=?")
        .get(entityId),
    ).toMatchObject({ label: "Donnée déjà synchronisée" });
    await close(restarted);
    const after = await Promise.all([path, original].map((v) => readFile(v)));
    expect(after).toEqual(before);
    expect(clearAuthentication).toHaveBeenCalledOnce();
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  // This file-backed integration scenario migrates two complete databases and reopens/bootstrap-applies one.
  // Keep the normal unit-test limit; loaded CI runners need a scoped integration budget.
}, 30_000);
