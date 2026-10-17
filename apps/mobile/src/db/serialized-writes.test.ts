import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { serializeLocalWrites } from "./serialized-writes";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-writers-")),
    path = join(dir, "local.db"),
    root = new DatabaseSync(path);
  root.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE actions(id INTEGER PRIMARY KEY); CREATE TABLE outbox(id INTEGER PRIMARY KEY);",
  );
  const raw = {
    async execAsync(sql: string) {
      root.exec(sql);
    },
    async runAsync(sql: string) {
      return root.prepare(sql).run();
    },
    async getFirstAsync(sql: string) {
      return root.prepare(sql).get() ?? null;
    },
    async getAllAsync(sql: string) {
      return root.prepare(sql).all();
    },
    async withExclusiveTransactionAsync(
      task: (db: SQLiteDatabase) => Promise<void>,
    ) {
      const tx = new DatabaseSync(path);
      try {
        tx.exec("BEGIN IMMEDIATE");
        await task({
          execAsync: async (sql: string) => {
            tx.exec(sql);
          },
        } as SQLiteDatabase);
        tx.exec("COMMIT");
      } catch (error) {
        if (tx.isTransaction) tx.exec("ROLLBACK");
        throw error;
      } finally {
        tx.close();
      }
    },
  } as unknown as Pick<
    SQLiteDatabase,
    | "execAsync"
    | "runAsync"
    | "getFirstAsync"
    | "getAllAsync"
    | "withExclusiveTransactionAsync"
  >;
  return {
    root,
    raw,
    close() {
      root.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
it("reproduces competing-connection SQLITE_BUSY before coordination", async () => {
  const f = fixture(),
    started = gate(),
    finish = gate();
  try {
    const importing = f.raw.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync("INSERT INTO actions VALUES(1)");
      started.release();
      await finish.promise;
      await tx.execAsync("INSERT INTO outbox VALUES(1)");
    });
    await started.promise;
    await expect(
      f.raw.runAsync("INSERT INTO actions VALUES(2)"),
    ).rejects.toThrow("locked");
    finish.release();
    await importing;
  } finally {
    finish.release();
    f.close();
  }
});
it("queues import, sync and direct writers while WAL reads remain usable and commits remain atomic", async () => {
  const f = fixture(),
    started = gate(),
    finish = gate(),
    db = serializeLocalWrites(f.raw),
    order: string[] = [];
  try {
    expect(serializeLocalWrites(db)).toBe(db);
    const importing = db.withExclusiveTransactionAsync(async (tx) => {
      order.push("import");
      await tx.execAsync("INSERT INTO actions VALUES(1)");
      started.release();
      await finish.promise;
      await tx.execAsync("INSERT INTO outbox VALUES(1)");
    });
    await started.promise;
    const sync = db.withExclusiveTransactionAsync(async (tx) => {
      order.push("sync");
      await tx.execAsync(
        "INSERT INTO actions VALUES(2);INSERT INTO outbox VALUES(2)",
      );
    });
    const direct = db
      .runAsync("INSERT INTO actions VALUES(3)")
      .then(() => order.push("direct"));
    const sequence = db.getFirstAsync(
      "INSERT INTO outbox VALUES(3) RETURNING id",
    );
    expect(await db.getFirstAsync("SELECT COUNT(*) n FROM actions")).toEqual({
      n: 0,
    });
    expect(order).toEqual(["import"]);
    finish.release();
    await Promise.all([importing, sync, direct]);
    expect(await sequence).toEqual({ id: 3 });
    expect(order).toEqual(["import", "sync", "direct"]);
    expect(f.root.prepare("SELECT * FROM actions ORDER BY id").all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(f.root.prepare("SELECT * FROM outbox ORDER BY id").all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
  } finally {
    finish.release();
    f.close();
  }
});
it("rolls back a failed transaction once and releases the queue for subsequent writers", async () => {
  const f = fixture(),
    db = serializeLocalWrites(f.raw);
  let executions = 0;
  try {
    const failure = db.withExclusiveTransactionAsync(async (tx) => {
      executions++;
      await tx.execAsync("INSERT INTO actions VALUES(1)");
      throw Error("cancelled");
    });
    const next = db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(
        "INSERT INTO actions VALUES(2);INSERT INTO outbox VALUES(2)",
      );
    });
    await expect(failure).rejects.toThrow("cancelled");
    await next;
    expect(executions).toBe(1);
    await expect(db.execAsync("INVALID SQL")).rejects.toThrow();
    await db.runAsync("INSERT INTO actions VALUES(3)");
    expect(f.root.prepare("SELECT * FROM actions ORDER BY id").all()).toEqual([
      { id: 2 },
      { id: 3 },
    ]);
    expect(f.root.prepare("SELECT * FROM outbox ORDER BY id").all()).toEqual([
      { id: 2 },
    ]);
  } finally {
    f.close();
  }
});
