import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { buildProductDailyPerformance } from "@fl-copilot/analytics-core";
import { productDailyGoldenFixture } from "../../../../packages/test-fixtures/src/product-daily";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
  enqueueAnalyticsRecomputationJob,
  type ProductDateScope,
} from "./local-recomputation";

type SQLiteValue = string | number | null;

class NodeDatabase implements OutboxDatabase, AtomicMutationDatabase {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const directories: string[] = [];
const now = "2026-10-04T10:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local analytics recomputation", () => {
  it("deduplicates scopes and yields between processing chunks", async () => {
    const { adapter, database } = await openDatabase();
    const scopes = Array.from({ length: 5 }, (_, index) => ({
      productId: `product-${index}`,
      businessDate: "2026-10-03",
    }));
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "job-1",
      storeId: "store-1",
      scopes: [scopes[2]!, ...scopes, scopes[2]!],
      createdAt: now,
    });
    const recomputed: ProductDateScope[] = [];
    const departmentDates: string[] = [];
    let yields = 0;
    const scheduler = new LocalAnalyticsRecomputationScheduler(
      adapter,
      {
        async recomputeProduct(_storeId, scope) {
          recomputed.push(scope);
        },
        async recomputeDepartment(_storeId, businessDate) {
          departmentDates.push(businessDate);
        },
      },
      {
        chunkSize: 2,
        now: () => now,
        yieldToInterface: async () => {
          yields += 1;
        },
      },
    );

    await expect(scheduler.process("store-1")).resolves.toEqual({
      attemptedJobs: 1,
      completedJobs: 1,
      failedJobs: 0,
      completedScopes: 5,
    });
    expect(recomputed).toEqual(scopes);
    expect(departmentDates).toEqual(["2026-10-03"]);
    expect(yields).toBe(2);
    expect(
      database
        .prepare("SELECT status, attempt_count FROM local_jobs WHERE id = ?")
        .get("job-1"),
    ).toEqual({ status: "COMPLETED", attempt_count: 1 });
    database.close();
  });

  it("coalesces concurrent processing for one store", async () => {
    const { adapter, database } = await openDatabase();
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "job-1",
      storeId: "store-1",
      scopes: [{ productId: "product-1", businessDate: "2026-10-03" }],
      createdAt: now,
    });
    let releases = 0;
    const scheduler = new LocalAnalyticsRecomputationScheduler(adapter, {
      async recomputeProduct() {
        await Promise.resolve();
        releases += 1;
      },
      async recomputeDepartment() {},
    });

    const first = scheduler.process("store-1");
    const second = new LocalAnalyticsRecomputationScheduler(adapter, {
      async recomputeProduct() {
        throw Error("duplicate scheduler must not run");
      },
      async recomputeDepartment() {
        throw Error("duplicate scheduler must not run");
      },
    }).process("store-1");
    expect(second).toBe(first);
    await first;
    expect(releases).toBe(1);
    database.close();
  });

  it("recovers six interrupted local calculations without republishing or recovering another store", async () => {
    const { adapter, database } = await openDatabase();
    const { readPendingWork } = await import("../sync/pending-work");
    for (let i = 0; i < 7; i++) {
      await enqueueAnalyticsRecomputationJob(adapter, {
        jobId: `interrupted-${i}`,
        storeId: i === 6 ? "other-store" : "store-1",
        scopes: [{ productId: "product-1", businessDate: "2026-10-03" }],
        createdAt: now,
      });
    }
    database.exec("UPDATE local_jobs SET status='RUNNING',attempt_count=1");
    expect(await readPendingWork(adapter, "store-1")).toEqual([
      {
        label: "Calcul des indicateurs locaux",
        count: 6,
        state: "En cours",
        code: null,
      },
    ]);
    let recomputed = 0;
    const scheduler = new LocalAnalyticsRecomputationScheduler(
      adapter,
      {
        async recomputeProduct() {
          recomputed++;
        },
        async recomputeDepartment() {},
      },
      { now: () => now },
    );
    expect((await scheduler.process("store-1")).completedJobs).toBe(6);
    expect(recomputed).toBe(1);
    expect(await readPendingWork(adapter, "store-1")).toEqual([]);
    expect(
      database
        .prepare("SELECT status FROM local_jobs WHERE id='interrupted-6'")
        .get(),
    ).toEqual({ status: "RUNNING" });
    expect(
      database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
    ).toEqual({ n: 0 });
    expect((await scheduler.process("store-1")).attemptedJobs).toBe(0);
    database.close();
  });

  it("retries a failed idempotent job and stops at the configured limit", async () => {
    const { adapter, database } = await openDatabase();
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "job-1",
      storeId: "store-1",
      scopes: [{ productId: "product-1", businessDate: "2026-10-03" }],
      createdAt: now,
    });
    const scheduler = new LocalAnalyticsRecomputationScheduler(
      adapter,
      {
        async recomputeProduct() {
          throw new Error("temporary calculation failure");
        },
        async recomputeDepartment() {},
      },
      { maximumAttempts: 2, now: () => now },
    );

    await scheduler.process("store-1");
    expect(jobState(database, "job-1")).toEqual({
      status: "RETRY",
      attempt_count: 1,
      last_error: "temporary calculation failure",
    });
    await scheduler.process("store-1");
    expect(jobState(database, "job-1")).toEqual({
      status: "FAILED",
      attempt_count: 2,
      last_error: "temporary calculation failure",
    });
    database.close();
  });

  it("drains 17 overlapping jobs once per product/day without touching the remaining send", async () => {
    const { adapter, database } = await openDatabase();
    const scopes = Array.from({ length: 600 }, (_, i) => ({
      productId: `product-${i}`,
      businessDate: "2026-10-03",
    }));
    for (let i = 0; i < 17; i++)
      await enqueueAnalyticsRecomputationJob(adapter, {
        jobId: `overlap-${i}`,
        storeId: "store-1",
        scopes,
        createdAt: now,
      });
    const { OutboxRepository } = await import("../sync/outbox-repository");
    await new OutboxRepository(adapter).enqueue({
      commandId: "retained-command",
      storeId: "store-1",
      deviceId: "device",
      commandType: "PRODUCT_UPSERT",
      entityType: "product",
      entityId: "p",
      payload: { retained: true },
    });
    let products = 0,
      departments = 0;
    const result = await new LocalAnalyticsRecomputationScheduler(
      adapter,
      {
        async recomputeProduct() {
          products++;
        },
        async recomputeDepartment() {
          departments++;
        },
      },
      { yieldToInterface: async () => undefined },
    ).process("store-1");
    expect(result).toMatchObject({
      completedJobs: 17,
      completedScopes: 600,
      failedJobs: 0,
    });
    expect(products).toBe(600);
    expect(departments).toBe(1);
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM local_jobs WHERE status='COMPLETED'")
        .get(),
    ).toEqual({ n: 17 });
    expect(
      database
        .prepare(
          "SELECT status,payload_json FROM sync_outbox WHERE command_id='retained-command'",
        )
        .get(),
    ).toEqual({
      status: "PENDING",
      payload_json: JSON.stringify({ retained: true }),
    });
    database.close();
  });

  it("recomputes 17 overlapping 600-product SQLite jobs in bounded transactions with unchanged canonical projections", async () => {
    const { adapter, database } = await openDatabase();
    const insert = database.prepare(
      "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty) VALUES(?,'store-1','Tomate','VEGETABLE','BULK','KG','ACTIVE',1,?,?,'SYNCED',0)",
    );
    const scopes = Array.from({ length: 600 }, (_, i) => ({
      productId: `product-${i}`,
      businessDate: "2026-10-03",
    }));
    for (const scope of scopes) insert.run(scope.productId, now, now);
    for (let i = 0; i < 17; i++)
      await enqueueAnalyticsRecomputationJob(adapter, {
        jobId: `real-${i}`,
        storeId: "store-1",
        scopes,
        createdAt: now,
      });
    const transactions = vi.spyOn(adapter, "withExclusiveTransactionAsync");
    const result = await new LocalAnalyticsRecomputationScheduler(
      adapter,
      new SQLiteProductDateRecomputer(adapter, () => now),
      { now: () => now, yieldToInterface: async () => undefined },
    ).process("store-1");
    expect(result).toMatchObject({
      completedJobs: 17,
      failedJobs: 0,
      completedScopes: 600,
    });
    expect(transactions.mock.calls.length).toBeLessThan(100);
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM product_daily_performance")
        .get(),
    ).toEqual({ n: 600 });
    expect(
      cachedPayload(database, "department_daily_performance"),
    ).toMatchObject({ productCount: 600 });
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM local_jobs WHERE status='COMPLETED'")
        .get(),
    ).toEqual({ n: 17 });
    console.log(
      "analytics-backlog-stress",
      JSON.stringify({
        jobs: 17,
        uniqueProductDays: 600,
        completed: result.completedJobs,
        projectionTransactions: transactions.mock.calls.length,
      }),
    );
    database.close();
  });

  it("does not cache a failed scope or forget work added while a cycle is running", async () => {
    const { adapter, database } = await openDatabase();
    const scope = { productId: "p", businessDate: "2026-10-03" };
    for (const jobId of ["a", "b"])
      await enqueueAnalyticsRecomputationJob(adapter, {
        jobId,
        storeId: "store-1",
        scopes: [scope],
        createdAt: now,
      });
    let calls = 0;
    const scheduler = new LocalAnalyticsRecomputationScheduler(adapter, {
      async recomputeProduct() {
        calls++;
        if (calls === 1) throw Error("temporary");
        if (calls === 2)
          await enqueueAnalyticsRecomputationJob(adapter, {
            jobId: "new-work",
            storeId: "store-1",
            scopes: [scope],
            createdAt: now,
          });
      },
      async recomputeDepartment() {},
    });
    expect(await scheduler.process("store-1")).toMatchObject({
      completedJobs: 1,
      failedJobs: 1,
      completedScopes: 1,
    });
    expect(jobState(database, "a")?.status).toBe("RETRY");
    expect(jobState(database, "new-work")?.status).toBe("PENDING");
    expect(await scheduler.process("store-1")).toMatchObject({
      completedJobs: 2,
      failedJobs: 0,
      completedScopes: 1,
    });
    expect(calls).toBe(3);
    database.close();
  });

  it("refreshes the department again if another job adds a different product on the same day", async () => {
    const { adapter, database } = await openDatabase();
    for (const productId of ["a", "b"])
      await enqueueAnalyticsRecomputationJob(adapter, {
        jobId: productId,
        storeId: "store-1",
        scopes: [{ productId, businessDate: "2026-10-03" }],
        createdAt: now,
      });
    const seen: string[] = [];
    await new LocalAnalyticsRecomputationScheduler(adapter, {
      async recomputeProduct(_store, scope) {
        seen.push(scope.productId);
      },
      async recomputeDepartment() {
        seen.push("department");
      },
    }).process("store-1");
    expect(seen).toEqual(["a", "department", "b", "department"]);
    database.close();
  });

  it("batches real SQLite projections with identical values and rolls back a failing batch", async () => {
    const { adapter, database } = await openDatabase();
    insertAnalyticsFixture(database);
    const recomputer = new SQLiteProductDateRecomputer(adapter, () => now);
    const scopes = [
      { productId: "product-1", businessDate: "2026-10-03" },
      { productId: "product-1", businessDate: "2026-10-04" },
    ];
    for (const scope of scopes)
      await recomputer.recomputeProduct("store-1", scope);
    const before = database
      .prepare("SELECT * FROM product_daily_performance ORDER BY id")
      .all();
    database.exec("DELETE FROM product_daily_performance");
    await recomputer.recomputeProducts("store-1", scopes);
    expect(
      database
        .prepare("SELECT * FROM product_daily_performance ORDER BY id")
        .all(),
    ).toEqual(before);
    database.exec("DELETE FROM product_daily_performance");
    await expect(
      recomputer.recomputeProducts("store-1", [
        ...scopes,
        { productId: "missing", businessDate: "2026-10-03" },
      ]),
    ).rejects.toThrow("unavailable");
    expect(
      database
        .prepare("SELECT COUNT(*) n FROM product_daily_performance")
        .get(),
    ).toEqual({ n: 0 });
    database.close();
  });

  it("recomputes and caches the exact product day and department day", async () => {
    const { adapter, database } = await openDatabase();
    insertAnalyticsFixture(database);
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "job-analytics",
      storeId: "store-1",
      sourceDocumentId: "document-1",
      scopes: [{ productId: "product-1", businessDate: "2026-10-03" }],
      createdAt: now,
    });
    const scheduler = new LocalAnalyticsRecomputationScheduler(
      adapter,
      new SQLiteProductDateRecomputer(adapter, () => now),
      { now: () => now },
    );

    await expect(scheduler.process("store-1")).resolves.toMatchObject({
      completedJobs: 1,
      completedScopes: 1,
    });
    const product = cachedPayload(database, "product_daily_performance");
    expect(product).toMatchObject({
      storeId: "store-1",
      productId: "product-1",
      date: "2026-10-03",
      sales: { quantity: "10", salesValue: "50.00" },
      waste: { quantity: "2", purchaseValueKnown: "3.00" },
      computedAt: now,
    });
    const department = cachedPayload(database, "department_daily_performance");
    expect(department).toMatchObject({
      storeId: "store-1",
      date: "2026-10-03",
      sales: { salesValue: "50.00" },
      waste: { purchaseValueKnown: "3.00" },
      productCount: 1,
      computedAt: now,
    });
    database.close();
  });
});

it("refreshes legacy source-channel coverage offline without republishing and skips incomplete bootstraps", async () => {
  const { adapter, database } = await openDatabase();
  const day = productDailyGoldenFixture.businessDate,
    storeId = productDailyGoldenFixture.product.storeId;
  const sales = buildProductDailyPerformance({
    ...productDailyGoldenFixture,
    wasteObservations: [],
  });
  const waste = {
    ...buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      salesObservations: [],
    }),
    productId: "88888888-8888-4888-8888-888888888888",
  };
  for (const p of [sales, waste]) {
    database
      .prepare(
        "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty) VALUES(?,?,'Produit test','FRUIT','BULK','KG','ACTIVE',1,?,?,'SYNCED',0)",
      )
      .run(p.productId, storeId, now, now);
    database
      .prepare(
        "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,'LOCAL','product-daily-v1',?,?)",
      )
      .run(
        p.productId,
        storeId,
        p.productId,
        day,
        JSON.stringify(p),
        p.inputRevision,
        now,
      );
  }
  const legacy = {
    storeId,
    date: day,
    sales: { salesValue: "60.50" },
    productCount: 2,
  };
  for (const [id, store, count] of [
    ["legacy", storeId, 2],
    ["foreign", "other-store", 2],
    ["bootstrap", "bootstrap-store", 2],
  ] as const) {
    database
      .prepare(
        "INSERT INTO department_daily_performance(id,store_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,'LOCAL','department-daily-v1','legacy',?)",
      )
      .run(
        id,
        store,
        day,
        JSON.stringify({ ...legacy, storeId: store, productCount: count }),
        now,
      );
  }
  const beforeProducts = database
    .prepare("SELECT * FROM product_daily_performance ORDER BY id")
    .all();
  const scheduler = new LocalAnalyticsRecomputationScheduler(
    adapter,
    new SQLiteProductDateRecomputer(adapter, () => now),
  );
  await scheduler.process(storeId);
  const payload = JSON.parse(
    (
      database
        .prepare(
          "SELECT payload_json FROM department_daily_performance WHERE store_id=?",
        )
        .get(storeId) as { payload_json: string }
    ).payload_json,
  );
  expect(payload.sales.salesValue).toBe("60.50");
  expect(payload.availability.salesValue).toMatchObject({
    status: "AVAILABLE",
    inputCount: 1,
  });
  expect(payload.availability.wasteSalesValue).toMatchObject({
    status: "AVAILABLE",
    inputCount: 1,
  });
  expect(
    database
      .prepare("SELECT * FROM product_daily_performance ORDER BY id")
      .all(),
  ).toEqual(beforeProducts);
  const after = database
    .prepare("SELECT * FROM department_daily_performance ORDER BY id")
    .all();
  await scheduler.process(storeId);
  await scheduler.process("bootstrap-store");
  expect(
    database
      .prepare("SELECT * FROM department_daily_performance ORDER BY id")
      .all(),
  ).toEqual(after);
  expect(database.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual({
    n: 0,
  });
  expect(database.prepare("SELECT COUNT(*) n FROM local_jobs").get()).toEqual({
    n: 0,
  });
  database.close();
});

it("does not turn a deferred historical cache refresh into a failed accepted calculation", async () => {
  const { adapter, database } = await openDatabase();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "accepted",
      storeId: "store-1",
      scopes: [{ productId: "p", businessDate: "2026-10-23" }],
      createdAt: now,
    });
    const scheduler = new LocalAnalyticsRecomputationScheduler(adapter, {
      async recomputeProduct() {},
      async recomputeDepartment() {},
      async refreshDepartmentCoverage() {
        throw Error("damaged derived cache");
      },
    });
    await expect(scheduler.process("store-1")).resolves.toMatchObject({
      completedJobs: 1,
      failedJobs: 0,
    });
    expect(jobState(database, "accepted")?.status).toBe("COMPLETED");
    expect(warn).toHaveBeenCalledWith("ANALYTICS_COVERAGE_REFRESH_DEFERRED");
  } finally {
    warn.mockRestore();
    database.close();
  }
});

async function openDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-analytics-"));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  const adapter = new NodeDatabase(database);
  await runLocalMigrations(adapter);
  return { adapter, database };
}

function jobState(database: DatabaseSync, id: string) {
  return database
    .prepare(
      "SELECT status, attempt_count, last_error FROM local_jobs WHERE id = ?",
    )
    .get(id);
}

function cachedPayload(database: DatabaseSync, table: string) {
  const row = database.prepare(`SELECT payload_json FROM ${table}`).get() as {
    payload_json: string;
  };
  return JSON.parse(row.payload_json) as unknown;
}

function insertAnalyticsFixture(database: DatabaseSync) {
  database.exec(`
    INSERT INTO products (
      id, store_id, label, category, nature, sales_unit, status, version,
      created_at, updated_at, deleted_at, sync_state, dirty
    ) VALUES (
      'product-1', 'store-1', 'Tomate', 'VEGETABLE', 'BULK', 'KG',
      'ACTIVE', 1, '${now}', '${now}', NULL, 'SYNCED', 0
    );

    INSERT INTO source_documents (
      id, store_id, source_type, original_filename, local_processing_status,
      remote_upload_status, version, created_at, updated_at, deleted_at,
      sync_state, dirty
    ) VALUES (
      'document-1', 'store-1', 'MERCALYS_SALES', 'sales.xlsx', 'PUBLISHED',
      'PENDING', 1, '${now}', '${now}', NULL, 'PENDING', 1
    );
    INSERT INTO source_records (
      id, store_id, source_document_id, source_index, raw_payload_json,
      normalized_payload_json, status, error_codes_json, warning_codes_json,
      version, created_at, updated_at, deleted_at
    ) VALUES
      ('record-sales', 'store-1', 'document-1', 1, '{}', '{}', 'PUBLISHED', '[]', '[]', 1, '${now}', '${now}', NULL),
      ('record-waste', 'store-1', 'document-1', 2, '{}', '{}', 'PUBLISHED', '[]', '[]', 1, '${now}', '${now}', NULL);

    INSERT INTO sales_observations (
      id, store_id, product_id, business_date, quantity, purchase_value,
      sales_value, margin_value, source_document_id, source_record_id,
      validation_status, version, created_at, updated_at, deleted_at,
      sync_state, dirty
    ) VALUES (
      'sales-1', 'store-1', 'product-1', '2026-10-03', '10', '30.00',
      '50.00', '20.00', 'document-1', 'record-sales', 'VALIDATED', 1,
      '${now}', '${now}', NULL, 'PENDING', 1
    );

    INSERT INTO waste_observations (
      id, store_id, product_id, business_date, product_nature, quantity,
      purchase_value_known, purchase_value_estimated, sales_value,
      cost_quality, source_type, source_document_id, source_record_id,
      validation_status, version, created_at, updated_at, deleted_at,
      sync_state, dirty
    ) VALUES (
      'waste-1', 'store-1', 'product-1', '2026-10-03', 'BULK', '2',
      '3.00', NULL, '5.00', 'KNOWN', 'MERCALYS', 'document-1',
      'record-waste', 'VALIDATED', 1, '${now}', '${now}', NULL, 'PENDING', 1
    );
  `);
}

it("explicitly resumes only failed projections, retains attempts and payload, and rolls back a revoked context", async () => {
  const { retryFailedAnalyticsJobs } = await import("./local-recomputation");
  const { readPendingWork } = await import("../sync/pending-work");
  const { adapter, database } = await openDatabase();
  const storeId = "00000000-0000-4000-8000-000000000001",
    productId = "00000000-0000-4000-8000-000000000002";
  try {
    await enqueueAnalyticsRecomputationJob(adapter, {
      jobId: "failed",
      storeId,
      scopes: [{ productId, businessDate: "2026-10-31" }],
      createdAt: now,
    });
    await adapter.runAsync(
      "UPDATE local_jobs SET status='FAILED',attempt_count=3,last_error='SQLite Error code 5: database is locked' WHERE id='failed'",
    );
    await adapter.runAsync(
      "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES('source','SOURCE_UPLOAD_AND_REGISTER',?,'FAILED',1,?,?)",
      JSON.stringify({ storeId }),
      now,
      now,
    );
    const before = await adapter.getFirstAsync(
      "SELECT * FROM local_jobs WHERE id='failed'",
    );
    let checks = 0;
    await expect(
      retryFailedAnalyticsJobs(adapter, storeId, () => ++checks < 2),
    ).rejects.toThrow("SCOPE_CHANGED");
    expect(
      await adapter.getFirstAsync("SELECT * FROM local_jobs WHERE id='failed'"),
    ).toEqual(before);
    expect(
      (await readPendingWork(adapter, storeId)).find((x) => x.retryAction),
    ).toMatchObject({
      code: "ANALYTICS_SQLITE_BUSY",
      retryAction: "ANALYTICS_RECOMPUTE",
    });
    expect(await retryFailedAnalyticsJobs(adapter, storeId, () => true)).toBe(
      1,
    );
    expect(jobState(database, "failed")).toMatchObject({
      status: "RETRY",
      attempt_count: 3,
      last_error: "SQLite Error code 5: database is locked",
    });
    expect(
      await adapter.getFirstAsync(
        "SELECT status FROM local_jobs WHERE id='source'",
      ),
    ).toEqual({ status: "FAILED" });
    const scheduler = new LocalAnalyticsRecomputationScheduler(adapter, {
      recomputeProduct: async () => {},
      recomputeDepartment: async () => {},
    });
    expect(await scheduler.process(storeId)).toMatchObject({
      completedJobs: 1,
      failedJobs: 0,
    });
    expect(jobState(database, "failed")).toMatchObject({
      status: "COMPLETED",
      attempt_count: 4,
    });
  } finally {
    database.close();
  }
});
