import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductMatchResult } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";

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
const storeId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-09-28T18:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MercalysImportPublicationRepository", () => {
  it("publishes ready sales locally with lineage and a pending upload job", async () => {
    const { adapter, database, path } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );

    await expect(
      repository.publish(input(summary("MERCALYS_SALES"))),
    ).resolves.toMatchObject({
      publishedCount: 1,
      remainingCount: 1,
    });
    database.close();

    const reopened = new DatabaseSync(path);
    expect(
      reopened
        .prepare("SELECT COUNT(*) AS count FROM sales_observations")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      reopened
        .prepare("SELECT COUNT(*) AS count FROM waste_observations")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      reopened
        .prepare(
          "SELECT quantity, sales_value, sync_state, dirty FROM sales_observations",
        )
        .get(),
    ).toEqual({
      quantity: "2.5",
      sales_value: "12.4",
      sync_state: "PENDING",
      dirty: 1,
    });
    expect(
      reopened
        .prepare(
          "SELECT status, COUNT(*) AS count FROM source_records GROUP BY status ORDER BY status",
        )
        .all(),
    ).toEqual([
      { status: "PUBLISHED", count: 1 },
      { status: "WARNING", count: 1 },
    ]);
    expect(
      reopened
        .prepare(
          "SELECT local_processing_status, remote_upload_status, sync_state FROM source_documents",
        )
        .get(),
    ).toEqual({
      local_processing_status: "PUBLISHED",
      remote_upload_status: "PENDING",
      sync_state: "PENDING",
    });
    expect(
      reopened.prepare("SELECT type, status FROM local_jobs").get(),
    ).toEqual({
      type: "SOURCE_UPLOAD_AND_REGISTER",
      status: "PENDING",
    });
    reopened.close();
  });

  it("uses the matched product nature for waste observations", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "PACKAGED");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );

    await repository.publish(input(summary("MERCALYS_WASTE")));

    expect(
      database
        .prepare(
          "SELECT product_nature, purchase_value_known, purchase_value_estimated, cost_quality, source_type FROM waste_observations",
        )
        .get(),
    ).toEqual({
      product_nature: "PACKAGED",
      purchase_value_known: "7.1",
      purchase_value_estimated: null,
      cost_quality: "KNOWN",
      source_type: "MERCALYS",
    });
    database.close();
  });

  it("rolls the whole publication back if the matched product is no longer active", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK", "INACTIVE");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );

    await expect(
      repository.publish(input(summary("MERCALYS_SALES"))),
    ).rejects.toThrow("Matched product is no longer active");
    for (const table of [
      "source_documents",
      "local_files",
      "source_records",
      "sales_observations",
      "local_jobs",
    ]) {
      expect(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
    }
    database.close();
  });
});

async function openDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-publication-"));
  directories.push(directory);
  const path = join(directory, "local.db");
  const database = new DatabaseSync(path);
  const adapter = new NodeDatabase(database);
  await runLocalMigrations(adapter);
  return { adapter, database, path };
}

function insertProduct(
  database: DatabaseSync,
  nature: "BULK" | "PACKAGED",
  status = "ACTIVE",
) {
  database
    .prepare(
      `
    INSERT INTO products (
      id, store_id, label, category, nature, sales_unit, status, version,
      created_at, updated_at, sync_state, dirty
    ) VALUES (?, ?, 'Tomate', 'VEGETABLE', ?, 'KG', ?, 1, ?, ?, 'SYNCED', 0)
  `,
    )
    .run(productId, storeId, nature, status, timestamp, timestamp);
}

function input(summaryValue: MercalysImportValidationSummary) {
  return {
    storeId,
    filename: "mercayls.xlsx",
    localFileUri: "file:///documents/mercalys.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 2048,
    checksum: "sha256:test",
    summary: summaryValue,
  };
}

function summary(
  sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE",
): MercalysImportValidationSummary {
  return {
    sourceType,
    parserVersion: "mercalys-article-v1",
    businessPeriodStart: "2026-09-26",
    businessPeriodEnd: "2026-09-26",
    detectedLineCount: 2,
    readyCount: 1,
    productReviewCount: 1,
    errorCount: 0,
    issueCodes: [],
    lines: [
      { record: record(8, "Tomate"), match: match("AUTO_MATCH") },
      { record: record(9, "Produit inconnu"), match: match("NO_MATCH") },
    ],
  };
}

function record(sourceIndex: number, rawLabel: string) {
  return {
    sourceIndex,
    itm8: "00000001",
    ean: "0000000000001",
    rawLabel,
    businessDate: "2026-09-26",
    quantity: 2.5,
    purchaseValue: 7.1,
    rceValue: 0,
    salesValue: 12.4,
    vatValue: 0.6,
    marginValue: 4.7,
    marginRate: 37.9,
    rawValues: {
      itm8: "00000001",
      ean: "0000000000001",
      rawLabel,
      businessDate: null,
      quantity: 2.5,
      purchaseValue: 7.1,
      rceValue: 0,
      salesValue: 12.4,
      vatValue: 0.6,
      marginValue: 4.7,
      marginRate: 37.9,
    },
  };
}

function match(state: "AUTO_MATCH" | "NO_MATCH"): ProductMatchResult {
  return {
    engineVersion: "product-matcher-v1",
    state,
    matchedProductId: state === "AUTO_MATCH" ? productId : null,
    method: state === "AUTO_MATCH" ? "EXACT_IDENTIFIER" : null,
    candidates: [],
    conflict: null,
  };
}

function idGenerator() {
  let next = 1;
  return () => {
    const suffix = String(next).padStart(12, "0");
    next += 1;
    return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
  };
}
