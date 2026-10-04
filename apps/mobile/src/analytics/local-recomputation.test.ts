import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
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
    const second = scheduler.process("store-1");
    expect(second).toBe(first);
    await first;
    expect(releases).toBe(1);
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
