import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, expect } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ExplorerRepository } from "./explorer-repository";
import {
  ExplorerViewRepository,
  initialExplorerView,
  drillExplorerView,
  backExplorerView,
  changeExplorerGranularity,
  shiftExplorerView,
} from "./explorer-state";
class Adapter implements OutboxDatabase {
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    work: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await work(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const at = "2026-10-19T12:00:00.000Z";
function insert(
  db: DatabaseSync,
  storeId: string,
  date: string,
  value: string | null,
  status = "AVAILABLE",
  payloadStore = storeId,
) {
  const payload = {
    storeId: payloadStore,
    date,
    sales: { salesValue: value, marginValue: "2.35" },
    waste: { salesValue: null },
    availability: {
      salesValue: { status: value === null ? "UNAVAILABLE" : status },
      salesMarginValue: { status: "AVAILABLE" },
      wasteSalesValue: { status: "UNAVAILABLE" },
    },
    formulaVersion: "department-daily-v1",
    computedAt: at,
  };
  db.prepare(
    "INSERT INTO department_daily_performance(id,store_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    storeId,
    date,
    JSON.stringify(payload),
    "LOCAL",
    "department-daily-v1",
    "test",
    at,
  );
}
it("reads actual migrated SQLite daily amounts, keeps sources isolated and never mutates the Outbox", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID();
  try {
    await runLocalMigrations(a);
    insert(db, store, "2026-10-15", "10.01");
    insert(db, store, "2025-10-16", "5.00");
    insert(db, randomUUID(), "2026-10-15", "9999");
    const repo = new ExplorerRepository(a),
      r = await repo.load(
        store,
        { kind: "day", date: "2026-10-15" },
        "sales",
        "2026-10-19",
      );
    expect(r.total).toBe("10.01");
    expect(r.comparison?.percentageDifference).toBe("100.20");
    expect(await repo.latestDate(store)).toBe("2026-10-15");
    expect(
      (
        await a.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox",
        )
      )?.n,
    ).toBe(0);
    expect(
      (
        await repo.load(
          store,
          { kind: "day", date: "2026-10-15" },
          "waste",
          "2026-10-19",
        )
      ).total,
    ).toBeNull();
  } finally {
    db.close();
  }
});
it("refuses corrupt scope and preserves explicit unavailable/partial values", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID();
  try {
    await runLocalMigrations(a);
    insert(db, store, "2026-10-15", "10.01", "PARTIAL");
    insert(db, store, "2025-10-16", "5");
    const repo = new ExplorerRepository(a),
      r = await repo.load(
        store,
        { kind: "day", date: "2026-10-15" },
        "sales",
        "2026-10-19",
      );
    expect(r.total).toBe("10.01");
    expect(r.comparison).toBeNull();
    insert(db, store, "2026-10-16", "999", "AVAILABLE", randomUUID());
    await expect(
      repo.load(
        store,
        { kind: "day", date: "2026-10-16" },
        "sales",
        "2026-10-19",
      ),
    ).rejects.toThrow("SCOPE");
  } finally {
    db.close();
  }
});
it("restores period, metric, drill history and exact scroll after file-backed restart, without sharing another user's view", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-explorer-")),
    path = join(dir, "local.db"),
    storeId = randomUUID(),
    ownerId = randomUUID();
  let db = new DatabaseSync(path);
  try {
    let a = new Adapter(db);
    await runLocalMigrations(a);
    let s = initialExplorerView("2026-10-15");
    s = { ...s, metric: "waste", frame: { ...s.frame, scroll: 421 } };
    const drilled = drillExplorerView(s, "2026-10-14");
    await new ExplorerViewRepository(a, { storeId, ownerId }).save(drilled);
    db.close();
    db = new DatabaseSync(path);
    a = new Adapter(db);
    const restored = await new ExplorerViewRepository(a, {
      storeId,
      ownerId,
    }).read();
    expect(restored).toEqual(drilled);
    expect(backExplorerView(restored!)).toEqual(s);
    expect(
      await new ExplorerViewRepository(a, {
        storeId,
        ownerId: randomUUID(),
      }).read(),
    ).toBeNull();
    expect(
      await new ExplorerViewRepository(a, {
        storeId: randomUUID(),
        ownerId,
      }).read(),
    ).toBeNull();
    expect(
      (
        await a.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox",
        )
      )?.n,
    ).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("anchors direct granularity changes, clamps civil dates, clears only drill history and refuses out-of-period drill", () => {
  const s = initialExplorerView("2026-01-31"),
    monthly = changeExplorerGranularity(s, "month"),
    next = shiftExplorerView(monthly, 1);
  expect(next.frame.anchor).toBe("2026-02-28");
  expect(next.metric).toBe(s.metric);
  const weekly = initialExplorerView("2026-10-15"),
    shift = shiftExplorerView(weekly, 1);
  expect(shift.frame.anchor).toBe("2026-10-22");
  const drilled = drillExplorerView(weekly, "2026-10-14");
  expect(changeExplorerGranularity(drilled, "year").history).toEqual([]);
  expect(backExplorerView(drilled)).toEqual(weekly);
  expect(() => drillExplorerView(weekly, "2025-01-01")).toThrow("OUTSIDE");
});
