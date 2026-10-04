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
import {
  MercalysExactDuplicateError,
  MercalysImportPublicationRepository,
  MercalysOverlapReconciliationError,
} from "./mercalys-import-publication";

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
const productIds = [
  productId,
  "22222222-2222-4222-8222-222222222223",
  "22222222-2222-4222-8222-222222222224",
  "22222222-2222-4222-8222-222222222225",
] as const;
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
      reopened
        .prepare("SELECT type, status FROM local_jobs ORDER BY type")
        .all(),
    ).toEqual([
      {
        type: "ANALYTICS_RECOMPUTE_PRODUCT_DATES",
        status: "PENDING",
      },
      { type: "SOURCE_UPLOAD_AND_REGISTER", status: "PENDING" },
    ]);
    expect(
      JSON.parse(
        (
          reopened
            .prepare(
              "SELECT payload_json FROM local_jobs WHERE type = 'ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
            )
            .get() as { payload_json: string }
        ).payload_json,
      ),
    ).toMatchObject({
      storeId,
      scopes: [{ productId, businessDate: "2026-09-26" }],
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

  it("detects an exact duplicate and cannot publish it twice", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    const publication = input(summary("MERCALYS_SALES"));

    const first = await repository.publish(publication);
    await expect(
      repository.findExactDuplicate(
        storeId,
        "MERCALYS_SALES",
        publication.checksum,
      ),
    ).resolves.toMatchObject({
      sourceDocumentId: first.sourceDocumentId,
      originalFilename: publication.filename,
      localProcessingStatus: "PUBLISHED",
      createdAt: timestamp,
    });
    const duplicateError = await repository
      .publish(publication)
      .catch((error: unknown) => error);
    expect(duplicateError).toBeInstanceOf(MercalysExactDuplicateError);
    expect(duplicateError).toMatchObject({
      priorImport: { sourceDocumentId: first.sourceDocumentId },
    });

    expect(
      database.prepare("SELECT COUNT(*) AS count FROM source_documents").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM sales_observations")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM local_jobs").get(),
    ).toEqual({ count: 2 });
    database.close();
  });

  it("does not conflate identical bytes from different Mercalys source types", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );

    await repository.publish(input(summary("MERCALYS_SALES")));
    await expect(
      repository.publish(input(summary("MERCALYS_WASTE"))),
    ).resolves.toMatchObject({ publishedCount: 1 });

    expect(
      database.prepare("SELECT COUNT(*) AS count FROM source_documents").get(),
    ).toEqual({ count: 2 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM waste_observations")
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it.each(["FAILED", "CANCELLED"])(
    "allows review and republishing after a %s import",
    async (failedStatus) => {
      const { adapter, database } = await openDatabase();
      insertProduct(database, "BULK");
      insertFailedSourceDocument(database, failedStatus);
      const repository = new MercalysImportPublicationRepository(
        adapter,
        idGenerator(),
        () => timestamp,
      );

      await expect(
        repository.findExactDuplicate(storeId, "MERCALYS_SALES", "sha256:test"),
      ).resolves.toBeNull();
      await expect(
        repository.publish(input(summary("MERCALYS_SALES"))),
      ).resolves.toMatchObject({ publishedCount: 1 });
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM source_documents")
          .get(),
      ).toEqual({ count: 2 });
      database.close();
    },
  );

  it("classifies and atomically applies an overlapping corrected version", async () => {
    const { adapter, database } = await openDatabase();
    productIds.forEach((id, index) =>
      insertProductRecord(database, id, `Produit ${index + 1}`),
    );
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    const initial = reconciliationSummary([
      matchedLine(8, productIds[0], 1),
      matchedLine(9, productIds[1], 2),
      matchedLine(10, productIds[2], 3),
    ]);
    await repository.publish(input(initial, "sha256:initial"));
    const corrected = reconciliationSummary([
      matchedLine(8, productIds[0], 1),
      matchedLine(9, productIds[1], 2.5),
      matchedLine(11, productIds[3], 4),
    ]);
    const reconciliation = await repository.analyzeOverlap(storeId, corrected);

    expect(reconciliation).toMatchObject({
      counts: {
        UNCHANGED: 1,
        MODIFIED: 1,
        ADDED: 1,
        REMOVED: 1,
        AMBIGUOUS: 0,
      },
      safeToApply: true,
    });
    const result = await repository.publish({
      ...input(corrected, "sha256:corrected"),
      reconciliationApproval: {
        fingerprint: reconciliation!.fingerprint,
        actorUserId: "99999999-9999-4999-8999-999999999999",
      },
    });

    expect(result).toMatchObject({ publishedCount: 3, replacedCount: 3 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(
      database
        .prepare(
          "SELECT quantity FROM sales_observations WHERE product_id = ? AND deleted_at IS NULL",
        )
        .get(productIds[1]),
    ).toEqual({ quantity: "2.5" });
    expect(
      database
        .prepare(
          "SELECT decision, actor_user_id, new_source_document_id FROM import_reconciliations",
        )
        .get(),
    ).toMatchObject({
      decision: "APPLY_NEW",
      actor_user_id: "99999999-9999-4999-8999-999999999999",
      new_source_document_id: result.sourceDocumentId,
    });
    database.close();
  });

  it("blocks blind publication and ambiguous bulk reconciliation", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    await repository.publish(
      input(
        reconciliationSummary([matchedLine(8, productId, 1)]),
        "sha256:initial",
      ),
    );
    const ambiguous = reconciliationSummary([
      matchedLine(8, productId, 2),
      matchedLine(9, productId, 3),
    ]);

    await expect(
      repository.publish(input(ambiguous, "sha256:ambiguous")),
    ).rejects.toBeInstanceOf(MercalysOverlapReconciliationError);
    const reconciliation = await repository.analyzeOverlap(storeId, ambiguous);
    expect(reconciliation).toMatchObject({
      counts: { AMBIGUOUS: 1 },
      safeToApply: false,
    });
    await expect(
      repository.publish({
        ...input(ambiguous, "sha256:ambiguous"),
        reconciliationApproval: {
          fingerprint: reconciliation!.fingerprint,
          actorUserId: "99999999-9999-4999-8999-999999999999",
        },
      }),
    ).rejects.toThrow("Ambiguous reconciliation cannot be applied");
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it("audits keeping existing observations without mutation", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    await repository.publish(
      input(
        reconciliationSummary([matchedLine(8, productId, 1)]),
        "sha256:initial",
      ),
    );
    const corrected = reconciliationSummary([matchedLine(8, productId, 5)]);
    const reconciliation = await repository.analyzeOverlap(storeId, corrected);

    await repository.keepExisting({
      storeId,
      filename: "corrected.xlsx",
      checksum: "sha256:kept",
      summary: corrected,
      reconciliation: reconciliation!,
      actorUserId: "99999999-9999-4999-8999-999999999999",
    });

    expect(
      database
        .prepare(
          "SELECT decision, new_source_document_id FROM import_reconciliations",
        )
        .get(),
    ).toEqual({ decision: "KEEP_EXISTING", new_source_document_id: null });
    expect(
      database
        .prepare(
          "SELECT quantity FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get(),
    ).toEqual({ quantity: "1" });
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
  insertProductRecord(database, productId, "Tomate", nature, status);
}

function insertProductRecord(
  database: DatabaseSync,
  id: string,
  label: string,
  nature: "BULK" | "PACKAGED" = "BULK",
  status = "ACTIVE",
) {
  database
    .prepare(
      `
    INSERT INTO products (
      id, store_id, label, category, nature, sales_unit, status, version,
      created_at, updated_at, sync_state, dirty
    ) VALUES (?, ?, ?, 'VEGETABLE', ?, 'KG', ?, 1, ?, ?, 'SYNCED', 0)
  `,
    )
    .run(id, storeId, label, nature, status, timestamp, timestamp);
}

function insertFailedSourceDocument(database: DatabaseSync, status: string) {
  database
    .prepare(
      `
        INSERT INTO source_documents (
          id, store_id, source_type, original_filename, checksum,
          local_processing_status, remote_upload_status, version,
          created_at, updated_at, sync_state, dirty
        ) VALUES (?, ?, 'MERCALYS_SALES', 'failed.xlsx', 'sha256:test', ?, 'FAILED', 1, ?, ?, 'ERROR', 1)
      `,
    )
    .run(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      storeId,
      status,
      timestamp,
      timestamp,
    );
}

function input(
  summaryValue: MercalysImportValidationSummary,
  checksum = "sha256:test",
) {
  return {
    storeId,
    filename: "mercayls.xlsx",
    localFileUri: "file:///documents/mercalys.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 2048,
    checksum,
    summary: summaryValue,
  };
}

function reconciliationSummary(
  lines: MercalysImportValidationSummary["lines"],
): MercalysImportValidationSummary {
  return {
    sourceType: "MERCALYS_SALES",
    parserVersion: "mercalys-article-v1",
    businessPeriodStart: "2026-09-26",
    businessPeriodEnd: "2026-09-26",
    detectedLineCount: lines.length,
    readyCount: lines.length,
    productReviewCount: 0,
    errorCount: 0,
    issueCodes: [],
    lines,
  };
}

function matchedLine(
  sourceIndex: number,
  matchedProductId: string,
  quantity: number,
) {
  const nextRecord = record(sourceIndex, `Produit ${sourceIndex}`);
  nextRecord.quantity = quantity;
  nextRecord.rawValues.quantity = quantity;
  return {
    record: nextRecord,
    match: {
      ...match("AUTO_MATCH"),
      matchedProductId,
    },
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
