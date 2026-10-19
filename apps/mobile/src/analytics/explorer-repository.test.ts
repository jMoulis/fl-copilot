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
    s = {
      ...s,
      metric: "waste",
      frame: {
        ...s.frame,
        scroll: 421,
        chartScroll: 83,
        detailsOffset: 20,
        filters: { category: "FRUIT", nature: "BULK", productId: null },
      },
    };
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
function insertProduct(
  db: DatabaseSync,
  storeId: string,
  id: string,
  label: string,
  category = "FRUIT",
  nature = "BULK",
) {
  db.prepare(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,'ACTIVE',1,?,?)",
  ).run(id, storeId, label, category, nature, "KG", at, at);
}
function insertProductDay(
  db: DatabaseSync,
  storeId: string,
  productId: string,
  date: string,
  value: string,
) {
  const payload = {
    storeId,
    productId,
    date,
    sales: { salesValue: value, marginValue: value },
    waste: { salesValue: value },
    availability: {
      salesValue: { status: "AVAILABLE" },
      salesMarginValue: { status: "AVAILABLE" },
      wasteSalesValue: { status: "AVAILABLE" },
    },
    formulaVersion: "product-daily-v1",
    computedAt: at,
  };
  db.prepare(
    "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,'LOCAL','product-daily-v1','test',?)",
  ).run(randomUUID(), storeId, productId, date, JSON.stringify(payload), at);
}
it("keeps official department totals distinct from filtered current-catalogue product amounts, without mixing another store", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID(),
    other = randomUUID(),
    fruit = randomUUID(),
    veg = randomUUID(),
    foreign = randomUUID();
  try {
    await runLocalMigrations(a);
    insert(db, store, "2026-10-15", "100");
    insertProduct(db, store, fruit, "Poire");
    insertProduct(db, store, veg, "Tomate", "VEGETABLE", "PACKAGED");
    insertProduct(db, other, foreign, "Autre magasin");
    insertProductDay(db, store, fruit, "2026-10-15", "10.01");
    insertProductDay(db, store, fruit, "2025-10-16", "5");
    insertProductDay(db, store, veg, "2026-10-15", "2");
    insertProductDay(db, other, foreign, "2026-10-15", "999");
    const repo = new ExplorerRepository(a),
      period = { kind: "day" as const, date: "2026-10-15" };
    const all = await repo.load(store, period, "sales", "2026-10-19");
    expect(all.total).toBe("100.00");
    expect(all.details?.analysis.total).toBe("12.01");
    expect(all.details?.totalContributors).toBe(2);
    const filtered = await repo.load(store, period, "sales", "2026-10-19", {
      category: "FRUIT",
      nature: "BULK",
      productId: null,
    });
    expect(filtered.total).toBe("10.01");
    expect(filtered.comparison?.absoluteDifference).toBe("5.01");
    expect((await repo.catalogue(store)).map((p) => p.label)).toEqual([
      "Poire",
      "Tomate",
    ]);
    expect(
      (
        await repo.load(store, period, "sales", "2026-10-19", {
          category: null,
          nature: null,
          productId: foreign,
        })
      ).total,
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
  }
});
it("reads more than one bounded SQL page with exact product/date cursors and complete totals", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID(),
    ids = Array.from({ length: 51 }, () => randomUUID());
  try {
    await runLocalMigrations(a);
    db.exec("BEGIN");
    for (const [i, id] of ids.entries())
      insertProduct(db, store, id, `Produit ${i}`);
    for (let n = 0; n < 100; n++) {
      const date = new Date(Date.parse("2026-01-01T12:00:00Z") + n * 86400000)
        .toISOString()
        .slice(0, 10);
      for (const id of ids) insertProductDay(db, store, id, date, "0.01");
    }
    db.exec("COMMIT");
    const r = await new ExplorerRepository(a).load(
      store,
      { kind: "year", year: 2026 },
      "sales",
      "2026-10-19",
      { category: "FRUIT", nature: null, productId: null },
      20,
    );
    expect(r.total).toBe("51.00");
    expect(r.coverage.complete).toBe(100);
    expect(r.coverage.missing).toBe(265);
    expect(r.details?.contributors).toHaveLength(20);
    expect(r.details?.totalContributors).toBe(51);
    expect(r.details?.offset).toBe(20);
    expect(r.comparison).toBeNull();
  } finally {
    db.close();
  }
});
