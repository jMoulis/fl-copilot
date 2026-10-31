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
  drillExplorerScope,
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
    expect(r.comparison).toMatchObject({
      status: "PARTIAL",
      referenceValue: "5",
    });
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
        productList: { trend: "DOWN", sort: "DIFFERENCE", direction: "ASC" },
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
it("reopens an exact conversational average and keeps the original DAY-query coverage universe, rather than upgrading a partial day", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  try {
    await runLocalMigrations(a);
    insertProduct(db, store, first, "Poire");
    insertProduct(db, store, second, "Tomate", "VEGETABLE", "PACKAGED");
    insertProductDay(db, store, first, "2026-10-01", "10");
    insertProductDay(db, store, second, "2026-10-01", "20");
    insertProductDay(db, store, second, "2026-10-02", "30");
    const period = {
      kind: "range" as const,
      current: { start: "2026-10-02", end: "2026-10-02" },
      reference: null,
      aggregation: "AVERAGE" as const,
      basis: "OBSERVED_PRODUCTS" as const,
      universe: { start: "2026-10-01", end: "2026-10-02" },
    };
    const r = await new ExplorerRepository(a).load(
      store,
      period,
      "sales",
      "2026-10-19",
    );
    expect(r.total).toBe("30");
    expect(r.mode).toBe("EXPLICIT");
    expect(r.sourceBasis).toBe("OBSERVED_PRODUCTS");
    expect(r.coverage).toEqual({
      complete: 0,
      partial: 1,
      missing: 0,
      expected: 1,
    });
    const filtered = await new ExplorerRepository(a).load(
      store,
      { ...period, universe: undefined },
      "sales",
      "2026-10-19",
      {
        category: null,
        nature: null,
        productId: null,
        productIds: [first, second],
        labelContains: "tomàte",
      },
    );
    expect(filtered.total).toBe("30");
    expect(filtered.details?.contributors.map((p) => p.productId)).toEqual([
      second,
    ]);
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
it("follows a server period source through its citation and native selection into SQLite without changing the original quoted mean", async () => {
  const { readPeriodAnalysis } =
    await import("../../../api/src/copilot/period-analysis-tool");
  const { renderAnswerText } =
    await import("../../../api/src/copilot/answer-text");
  const { readAnswerSource } = await import("../copilot/answer-source");
  const { explorerHref, applyExplorerLink } = await import("./explorer-link");
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    productId = randomUUID();
  try {
    await runLocalMigrations(a);
    insertProduct(db, storeId, productId, "Poire");
    for (const [date, value] of [
      ["2026-10-01", "10"],
      ["2026-10-02", "20"],
      ["2026-10-03", "30"],
      ["2025-09-02", "5"],
      ["2025-09-03", "10"],
      ["2025-09-04", "15"],
    ])
      insertProductDay(db, storeId, productId, date, value);
    const rows = db
      .prepare(
        "SELECT id,store_id,product_id,business_date,payload_json FROM product_daily_performance",
      )
      .all()
      .map((raw) => {
        const r = raw as {
            id: string;
            store_id: string;
            product_id: string;
            business_date: string;
            payload_json: string;
          },
          p = JSON.parse(r.payload_json);
        for (const key of ["salesValue", "salesMarginValue", "wasteSalesValue"])
          p.availability[key] = {
            ...p.availability[key],
            inputCount: 1,
            availableInputCount: 1,
            missingInputCount: 0,
          };
        return {
          _id: r.id,
          storeId: r.store_id,
          productId: r.product_id,
          date: r.business_date,
          performance: { ...p, inputRevision: "test" },
        };
      });
    const cursor = {
      maxTimeMS() {
        return this;
      },
      limit() {
        return this;
      },
      async toArray() {
        return rows;
      },
    };
    const remote = {
      collection: (name: string) =>
        name === "products"
          ? {
              findOne: async () => ({
                _id: productId,
                storeId,
                label: "Poire",
              }),
            }
          : { find: () => cursor },
    } as unknown as import("mongodb").Db;
    const result = await readPeriodAnalysis(remote, storeId, {
      productId,
      currentPeriod: { start: "2026-10-01", end: "2026-10-03" },
      referencePeriod: { start: "2025-09-02", end: "2025-09-04" },
      aggregation: "AVERAGE",
      metrics: ["sales"],
    });
    const quoted = result.evidence.find(
      (e) =>
        e.sourceType === "KPI" &&
        e.label.startsWith("Moyenne journalière") &&
        e.analyticsContext?.period.kind === "range" &&
        e.analyticsContext.period.current.start === "2026-10-01",
    )!;
    const text = renderAnswerText(
      "La moyenne est {{value:0}} €. {{source:0}}",
      [{ evidenceId: quoted.id }],
      result.evidence,
    );
    const source = readAnswerSource(/copilot-source:([^)]*)/.exec(text)![1]);
    const href = explorerHref({
      requestId: randomUUID(),
      ...source.analyticsContext!,
    });
    const selected = applyExplorerLink(
      initialExplorerView("2026-10-15"),
      href.params.selection,
    );
    await new ExplorerViewRepository(a, { storeId, ownerId }).save(selected);
    const restored = (await new ExplorerViewRepository(a, {
      storeId,
      ownerId,
    }).read())!;
    const r = await new ExplorerRepository(a).load(
      storeId,
      restored.frame.period,
      restored.metric,
      "2026-10-19",
      restored.frame.filters,
    );
    expect(r.total).toBe("20");
    expect(r.comparison?.referenceValue).toBe("10");
    expect(r.total).toBe(quoted.value);
    db.prepare(
      "UPDATE product_daily_performance SET payload_json=json_set(payload_json,'$.sales.salesValue','100') WHERE store_id=? AND business_date='2026-10-02'",
    ).run(storeId);
    const refreshed = await new ExplorerRepository(a).load(
      storeId,
      restored.frame.period,
      restored.metric,
      "2026-10-19",
      restored.frame.filters,
    );
    expect(refreshed.total).not.toBe(source.value);
    expect(source.value).toBe("20");
    expect(text).toContain("20 €");
  } finally {
    db.close();
  }
});

it("keeps purchase-cost and selling-value waste distinct for both department and product exploration", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    store = randomUUID(),
    product = randomUUID();
  try {
    await runLocalMigrations(a);
    insertProduct(db, store, product, "Poire");
    for (const date of ["2026-10-15", "2025-10-16"]) {
      insert(db, store, date, "100");
      insertProductDay(db, store, product, date, "99");
      for (const table of [
        "department_daily_performance",
        "product_daily_performance",
      ]) {
        const row = db
          .prepare(
            `SELECT id,payload_json FROM ${table} WHERE store_id=? AND business_date=?`,
          )
          .get(store, date) as { id: string; payload_json: string };
        const payload = JSON.parse(row.payload_json);
        payload.waste = {
          salesValue: "99",
          purchaseValueKnown: date === "2026-10-15" ? "3.25" : "11",
          purchaseValueEstimated: date === "2026-10-15" ? "2.25" : null,
        };
        payload.availability.wasteSalesValue = { status: "AVAILABLE" };
        payload.availability.wastePurchaseValueKnown = { status: "AVAILABLE" };
        payload.availability.wastePurchaseValueEstimated = {
          status: "AVAILABLE",
        };
        db.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(
          JSON.stringify(payload),
          row.id,
        );
      }
    }
    const repo = new ExplorerRepository(a),
      period = { kind: "day" as const, date: "2026-10-15" };
    for (const filters of [
      { category: null, nature: null, productId: null },
      { category: null, nature: null, productId: product },
    ]) {
      const cost = await repo.load(
        store,
        period,
        "wasteCost",
        "2026-10-19",
        filters,
      );
      expect(cost.total).toBe("5.50");
      expect(cost.comparison?.percentageDifference).toBe("-50.00");
      expect(
        (await repo.load(store, period, "waste", "2026-10-19", filters)).total,
      ).toBe("99.00");
      expect(cost.details?.contributors[0]?.analysis.total).toBe("5.50");
    }
    insert(db, store, "2026-10-16", "100");
    expect(
      (
        await repo.load(
          store,
          { kind: "day", date: "2026-10-16" },
          "wasteCost",
          "2026-10-19",
        )
      ).total,
    ).toBeNull();
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
  }
});

it("uses exactly the same product values through the detail context and Explorer link after offline restart, retaining zero and missing days", async () => {
  const { productPerformanceView, productPerformanceHref } =
    await import("../products/product-performance-context");
  const { applyExplorerLink } = await import("./explorer-link");
  const dir = mkdtempSync(join(tmpdir(), "fl-product-overview-data-")),
    path = join(dir, "store.db"),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    productId = randomUUID();
  let db = new DatabaseSync(path);
  try {
    let a = new Adapter(db);
    await runLocalMigrations(a);
    insertProduct(db, storeId, productId, "Tomate");
    insertProduct(db, storeId, randomUUID(), "Autre produit");
    insert(db, storeId, "2026-10-12", "9999");
    insertProductDay(db, storeId, productId, "2026-10-12", "10.10");
    insertProductDay(db, storeId, productId, "2026-10-13", "0");
    insertProductDay(db, storeId, productId, "2026-10-14", "5.55");
    const view = productPerformanceView(productId, "2026-10-15");
    await new ExplorerViewRepository(a, { storeId, ownerId, productId }).save(
      view,
    );
    const first = await new ExplorerRepository(a).load(
      storeId,
      view.frame.period,
      "sales",
      "2026-10-20",
      view.frame.filters,
    );
    expect(first.total).toBe("15.65");
    expect(first.coverage).toEqual({
      complete: 3,
      partial: 0,
      missing: 4,
      expected: 7,
    });
    expect(first.points[1]!.value).toBe("0");
    expect(first.points[3]!.value).toBeNull();
    const selected = applyExplorerLink(
      initialExplorerView("2026-10-20"),
      productPerformanceHref(productId, randomUUID(), view).params.selection,
    );
    db.close();
    db = new DatabaseSync(path);
    a = new Adapter(db);
    const restored = await new ExplorerViewRepository(a, {
      storeId,
      ownerId,
      productId,
    }).read();
    expect(restored).toEqual(view);
    const reopened = await new ExplorerRepository(a).load(
      storeId,
      selected.frame.period,
      selected.metric,
      "2026-10-20",
      selected.frame.filters,
    );
    expect(reopened).toEqual(first);
    db.prepare("UPDATE products SET category='VEGETABLE' WHERE id=?").run(
      productId,
    );
    expect(
      (
        await new ExplorerRepository(a).load(
          storeId,
          view.frame.period,
          "sales",
          "2026-10-20",
          view.frame.filters,
        )
      ).total,
    ).toBe("15.65");
    expect(await a.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox")).toEqual(
      { n: 0 },
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("restores a cleared product scope after SQLite restart and returns to the exact filtered analysis without changing business data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explorer-clear-scope-"));
  const file = join(dir, "local.db"),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    productId = randomUUID();
  let db = new DatabaseSync(file);
  try {
    await runLocalMigrations(new Adapter(db));
    insertProduct(db, storeId, productId, "Poire");
    const other = randomUUID();
    insertProduct(db, storeId, other, "Banane");
    insertProductDay(db, storeId, productId, "2026-10-15", "15");
    insertProductDay(db, storeId, other, "2026-10-15", "25");
    insert(db, storeId, "2026-10-15", "77");
    const initial = initialExplorerView("2026-10-15");
    const selected = {
      ...initial,
      frame: {
        ...initial.frame,
        period: { kind: "day" as const, date: "2026-10-15" },
        filters: {
          category: "FRUIT" as const,
          nature: "BULK" as const,
          productId,
          productIds: [productId],
          labelContains: "poire",
        },
        scroll: 375,
        chartScroll: 120,
        detailsOffset: 20,
      },
    };
    const cleared = drillExplorerScope(selected, {
      category: null,
      nature: null,
      productId: null,
    });
    await new ExplorerViewRepository(new Adapter(db), {
      storeId,
      ownerId,
    }).save(cleared);
    db.close();
    db = new DatabaseSync(file);
    const restored = (await new ExplorerViewRepository(new Adapter(db), {
      storeId,
      ownerId,
    }).read())!;
    expect(restored).toEqual(cleared);
    const read = (view: typeof restored) =>
      new ExplorerRepository(new Adapter(db)).load(
        storeId,
        view.frame.period,
        view.metric,
        "2026-10-23",
        view.frame.filters,
        view.frame.detailsOffset,
      );
    const full = await read(restored);
    expect(full.total).toBe("77.00"); // The official department total, not the 40 € product subtotal.
    const back = backExplorerView(restored);
    expect(back).toEqual(selected);
    expect((await read(back)).total).toBe("15.00");
    expect(
      db.prepare("SELECT count(*) AS count FROM sync_outbox").get(),
    ).toMatchObject({ count: 0 });
    expect(
      db
        .prepare("SELECT count(*) AS count FROM product_daily_performance")
        .get(),
    ).toMatchObject({ count: 2 });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
