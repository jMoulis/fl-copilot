import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductMatchResult } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  rematchMercalysImport,
  type MercalysImportValidationSummary,
} from "./mercalys-import-validation";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  buildMercalysProductResolutions,
  confirmMercalysProductMapping,
  correctMercalysProductMapping,
} from "./mercalys-product-resolution";
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
        repository.findExactDuplicate(
          storeId,
          "MERCALYS_SALES",
          "sha256:cf16da1864acaf650d969fe8eb470ac1c442324921eaff19a77692f7ec4ff542",
        ),
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
    await repository.publish(
      input(
        initial,
        "sha256:f116abe9beabcda5cc0a94a433e6a0c17209aed12cb06cbfada03bc1a111c205",
      ),
    );
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
      ...input(
        corrected,
        "sha256:9f17a7cb5faba30708db707f07c6e3db4d40e67b788ca2c545e2f1f6823e2c31",
      ),
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
        "sha256:f116abe9beabcda5cc0a94a433e6a0c17209aed12cb06cbfada03bc1a111c205",
      ),
    );
    const ambiguous = reconciliationSummary([
      matchedLine(8, productId, 2),
      matchedLine(9, productId, 3),
    ]);

    await expect(
      repository.publish(
        input(
          ambiguous,
          "sha256:5ccc45d48869f6f9031993bd144969d579452fe16da458e13469648221c9b984",
        ),
      ),
    ).rejects.toBeInstanceOf(MercalysOverlapReconciliationError);
    const reconciliation = await repository.analyzeOverlap(storeId, ambiguous);
    expect(reconciliation).toMatchObject({
      counts: { AMBIGUOUS: 1 },
      safeToApply: false,
    });
    await expect(
      repository.publish({
        ...input(
          ambiguous,
          "sha256:5ccc45d48869f6f9031993bd144969d579452fe16da458e13469648221c9b984",
        ),
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

  it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
    "reconciles distinct source codes on the same product/date and a reviewed product split atomically (%s)",
    async (sourceType) => {
      const { adapter, database, path } = await openDatabase();
      insertProductRecord(
        database,
        productIds[0],
        "BANANE RUBAN 5 FRUITS BIO MMP",
      );
      insertProductRecord(
        database,
        productIds[1],
        "PDT SALADE MICRO ONDE 500G",
      );
      const generateId = idGenerator(),
        now = () => timestamp;
      const repository = new MercalysImportPublicationRepository(
        adapter,
        generateId,
        now,
      );
      const lines = [
        [
          103,
          productIds[0],
          "0000087200198",
          "3250393062582",
          "BANANE RUBAN 5 FRUITS BIO MMP",
          1,
        ],
        [
          109,
          productIds[0],
          "0000087430008",
          "3347761000885",
          "BANANE RUBAN 5 FRUITS BIO",
          2.36,
        ],
        [
          153,
          productIds[1],
          "0000087950039",
          "3663362013537",
          "PDT RACLETTE MICRO ONDE 500G",
          3,
        ],
        [
          155,
          productIds[1],
          "0000087950040",
          "3663362013544",
          "PDT SALADE MICRO ONDE 500G",
          2,
        ],
      ] as const;
      const original = {
        ...reconciliationSummary(
          lines.map(([index, id, itm8, ean, rawLabel, quantity]) => {
            const line = matchedLine(index, id, quantity);
            Object.assign(line.record, { itm8, ean, rawLabel });
            Object.assign(line.record.rawValues, { itm8, ean, rawLabel });
            return line;
          }),
        ),
        sourceType,
      };
      const first = await repository.publish(input(original));
      const products = new ProductMasterRepository(adapter);
      for (const line of original.lines) {
        for (const type of ["ITM8", "EAN"] as const) {
          await products.upsertIdentifier(
            {
              id: generateId(),
              storeId,
              productId: line.match.matchedProductId!,
              type,
              value: (type === "ITM8" ? line.record.itm8 : line.record.ean)!,
              source: "MERCALYS",
              status: "VALIDATED",
              version: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
              deletedAt: null,
            },
            {
              commandId: generateId(),
              deviceId: "device",
              expectedRemoteVersion: null,
            },
          );
        }
      }
      const corrected = structuredClone(original);
      [2, 10.6, 4, 2].forEach((quantity, i) => {
        corrected.lines[i]!.record.quantity = quantity;
        corrected.lines[i]!.record.rawValues.quantity = quantity;
      });
      // Two valid codes for the same banana remain separate observations, not an ambiguous aggregate.
      const beforeSplit = await repository.analyzeOverlap(storeId, corrected);
      expect(beforeSplit).toMatchObject({
        safeToApply: true,
        counts: { MODIFIED: 3, UNCHANGED: 1, AMBIGUOUS: 0 },
      });
      expect(beforeSplit!.rows).toHaveLength(4);
      expect(buildMercalysProductResolutions(corrected)).toEqual([]);
      const resolution = buildMercalysProductResolutions(corrected, 153)[0]!;
      expect(resolution).toMatchObject({
        canCreate: false,
        canCreateAsDistinct: true,
        expectedProductIds: [productIds[1]],
      });
      await correctMercalysProductMapping(adapter, resolution, null, {
        storeId,
        deviceId: "device",
        now,
        generateId,
      });
      const commandCount = database
        .prepare("SELECT COUNT(*) count FROM sync_outbox")
        .get();
      await expect(
        correctMercalysProductMapping(adapter, resolution, null, {
          storeId,
          deviceId: "device",
          now,
          generateId,
        }),
      ).rejects.toThrow("MERCALYS_MAPPING_CHANGED");
      expect(
        database.prepare("SELECT COUNT(*) count FROM sync_outbox").get(),
      ).toEqual(commandCount);
      const catalog = {
        products: (await products.listProducts(storeId)).map((p) => p.entity),
        identifiers: (await products.listIdentifiersByStore(storeId)).map(
          (p) => p.entity,
        ),
        aliases: [],
      };
      const rematched = rematchMercalysImport(corrected, storeId, catalog);
      const distinctId = rematched.lines[2]!.match.matchedProductId!;
      expect(distinctId).not.toBe(productIds[1]);
      expect(rematched.lines[3]!.match.matchedProductId).toBe(productIds[1]);
      expect(
        rematched.lines.slice(0, 2).map((l) => l.match.matchedProductId),
      ).toEqual([productIds[0], productIds[0]]);
      const overlap = (await repository.analyzeOverlap(storeId, rematched))!;
      expect(overlap.safeToApply).toBe(true);
      expect(overlap.fingerprint).not.toBe(beforeSplit!.fingerprint);
      expect(
        overlap.rows.find((r) => r.incomingSourceIndex === 153),
      ).toMatchObject({
        category: "MODIFIED",
        existingProductIds: [productIds[1]],
        productId: distinctId,
      });
      const changedSecond = structuredClone(rematched);
      changedSecond.lines[1]!.record.quantity += 1;
      expect(
        (await repository.analyzeOverlap(storeId, changedSecond))!.fingerprint,
      ).not.toBe(overlap.fingerprint);
      const nextInput = {
        ...input(rematched, `sha256:${"b".repeat(64)}`),
        reconciliationApproval: {
          fingerprint: overlap.fingerprint,
          actorUserId: "99999999-9999-4999-8999-999999999999",
        },
      };
      await expect(
        repository.publish({
          ...nextInput,
          reconciliationApproval: {
            ...nextInput.reconciliationApproval,
            fingerprint: beforeSplit!.fingerprint,
          },
        }),
      ).rejects.toBeInstanceOf(MercalysOverlapReconciliationError);
      expect(await repository.publish(nextInput)).toMatchObject({
        publishedCount: 4,
        replacedCount: 4,
      });
      await expect(repository.publish(nextInput)).rejects.toBeInstanceOf(
        MercalysExactDuplicateError,
      );
      const table =
        sourceType === "MERCALYS_SALES"
          ? "sales_observations"
          : "waste_observations";
      expect(
        database
          .prepare(
            `SELECT COUNT(*) count FROM ${table} WHERE deleted_at IS NULL`,
          )
          .get(),
      ).toEqual({ count: 4 });
      expect(
        database
          .prepare(
            `SELECT quantity FROM ${table} WHERE deleted_at IS NULL AND product_id=? ORDER BY CAST(quantity AS REAL)`,
          )
          .all(productIds[0]),
      ).toEqual([{ quantity: "2" }, { quantity: "10.6" }]);
      expect(
        database
          .prepare(
            `SELECT COUNT(*) count FROM ${table} WHERE source_document_id=? AND deleted_at IS NOT NULL`,
          )
          .get(first.sourceDocumentId),
      ).toEqual({ count: 4 });
      const jobs = await adapter.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM local_jobs WHERE type='ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
      );
      expect(
        jobs.some((j) =>
          JSON.parse(j.payload_json).scopes.some(
            (scope: { productId: string }) => scope.productId === distinctId,
          ),
        ),
      ).toBe(true);
      database.close();
      const reopened = new DatabaseSync(path);
      expect(
        reopened
          .prepare(
            `SELECT COUNT(*) count FROM ${table} WHERE deleted_at IS NULL`,
          )
          .get(),
      ).toEqual({ count: 4 });
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) count FROM import_reconciliations WHERE decision='APPLY_NEW'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) count FROM source_records WHERE source_document_id=?",
          )
          .get(first.sourceDocumentId),
      ).toEqual({ count: 4 });
      reopened.close();
    },
  );

  it.each([
    "missing source codes",
    "duplicate existing source code",
    "duplicate incoming source code",
  ])(
    "keeps the conservative block for %s rather than silently summing",
    async (scenario) => {
      const { adapter, database } = await openDatabase();
      insertProduct(database, "BULK");
      const repository = new MercalysImportPublicationRepository(
        adapter,
        idGenerator(),
        () => timestamp,
      );
      const first = matchedLine(8, productId, 1),
        second = matchedLine(9, productId, 2);
      if (scenario !== "duplicate existing source code") {
        second.record.itm8 = "00000222";
        second.record.ean = "0000000000222";
      }
      const original = reconciliationSummary([first, second]);
      await repository.publish(input(original));
      if (scenario === "missing source codes")
        database.exec("UPDATE source_records SET normalized_payload_json='{}'");
      const incoming = structuredClone(original);
      if (scenario === "duplicate incoming source code")
        incoming.lines[1]!.record.itm8 = first.record.itm8;
      const overlap = (await repository.analyzeOverlap(storeId, incoming))!;
      expect(overlap.safeToApply).toBe(false);
      expect(overlap.counts.AMBIGUOUS).toBeGreaterThan(0);
      expect(
        new Set(overlap.rows.flatMap((r) => r.existingObservationIds)).size,
      ).toBe(2);
      await expect(
        repository.publish({
          ...input(incoming, `sha256:${"c".repeat(64)}`),
          reconciliationApproval: {
            fingerprint: overlap.fingerprint,
            actorUserId: "99999999-9999-4999-8999-999999999999",
          },
        }),
      ).rejects.toThrow("Ambiguous reconciliation");
      expect(
        database
          .prepare(
            "SELECT COUNT(*) count FROM sales_observations WHERE deleted_at IS NULL",
          )
          .get(),
      ).toEqual({ count: 2 });
      database.close();
    },
  );

  it("uses EAN when ITM8 is absent and retains single-row legacy comparison", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "BULK");
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    const line: MercalysImportValidationSummary["lines"][number] = matchedLine(
      8,
      productId,
      1,
    );
    line.record.itm8 = null;
    await repository.publish(input(reconciliationSummary([line])));
    const corrected = reconciliationSummary([structuredClone(line)]);
    corrected.lines[0]!.record.quantity = 2;
    expect(await repository.analyzeOverlap(storeId, corrected)).toMatchObject({
      safeToApply: true,
      counts: { MODIFIED: 1 },
    });
    database.exec("UPDATE source_records SET normalized_payload_json='{}'");
    expect(await repository.analyzeOverlap(storeId, corrected)).toMatchObject({
      safeToApply: true,
      counts: { MODIFIED: 1 },
    });
    database.close();
  });

  it("recomputes both the old and new product when a source row changes association", async () => {
    const { adapter, database } = await openDatabase();
    productIds
      .slice(0, 2)
      .forEach((id) => insertProductRecord(database, id, id));
    const repository = new MercalysImportPublicationRepository(
      adapter,
      idGenerator(),
      () => timestamp,
    );
    const original = reconciliationSummary([matchedLine(8, productIds[0], 1)]);
    await repository.publish(input(original));
    const corrected = structuredClone(original);
    corrected.lines[0]!.match.matchedProductId = productIds[1];
    const overlap = (await repository.analyzeOverlap(storeId, corrected))!;
    expect(overlap).toMatchObject({
      safeToApply: true,
      counts: { MODIFIED: 1, ADDED: 0, REMOVED: 0 },
    });
    const result = await repository.publish({
      ...input(corrected, `sha256:${"d".repeat(64)}`),
      reconciliationApproval: {
        fingerprint: overlap.fingerprint,
        actorUserId: "99999999-9999-4999-8999-999999999999",
      },
    });
    const job = await adapter.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM local_jobs WHERE id=?",
      result.analyticsJobId,
    );
    expect(JSON.parse(job!.payload_json).scopes).toEqual(
      expect.arrayContaining(
        productIds.slice(0, 2).map((productId) => ({
          productId,
          businessDate: original.businessPeriodStart,
        })),
      ),
    );
    database.close();
  });

  it("rolls back a distinct product, identifier transfers and Outbox together if an identity command fails", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, "PACKAGED");
    const generateId = idGenerator();
    const repository = new ProductMasterRepository(adapter);
    const corrected = reconciliationSummary([matchedLine(153, productId, 4)]);
    const code = corrected.lines[0]!.record.itm8!;
    await repository.upsertIdentifier(
      {
        id: generateId(),
        storeId,
        productId,
        type: "ITM8",
        value: code,
        source: "MERCALYS",
        status: "VALIDATED",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      { commandId: generateId(), deviceId: "device" },
    );
    const resolution = buildMercalysProductResolutions(corrected, 153)[0]!;
    const before = database.prepare("SELECT * FROM sync_outbox").all();
    database.exec(
      `CREATE TRIGGER fail_identity_command BEFORE INSERT ON sync_outbox WHEN NEW.command_type='PRODUCT_IDENTIFIER_UPSERT' BEGIN SELECT RAISE(ABORT, 'simulated identity failure'); END`,
    );
    await expect(
      correctMercalysProductMapping(adapter, resolution, null, {
        storeId,
        deviceId: "device",
        now: () => timestamp,
        generateId,
      }),
    ).rejects.toThrow("simulated identity failure");
    expect(
      database.prepare("SELECT COUNT(*) count FROM products").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT product_id, deleted_at FROM product_identifiers")
        .get(),
    ).toEqual({ product_id: productId, deleted_at: null });
    expect(database.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
    database.close();
  });

  it("reviews a 21 October correction imported on 23 October, resolves a product beyond line 20 and replaces once without losing the original or pending commands", async () => {
    const { adapter, database } = await openDatabase();
    const ids = Array.from(
      { length: 24 },
      (_, i) => `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
    );
    ids.forEach((id, i) =>
      insertProductRecord(database, id, `Produit ${i + 8}`),
    );
    const generateId = idGenerator(),
      now = () => "2026-10-23T10:00:00.000Z";
    const repository = new MercalysImportPublicationRepository(
      adapter,
      generateId,
      now,
    );
    const original = reconciliationSummary(
      ids.map((id, i) => {
        const line: MercalysImportValidationSummary["lines"][number] =
          matchedLine(i + 8, id, 1);
        line.record.businessDate = "2026-10-21";
        line.record.itm8 = String(i + 1).padStart(8, "0");
        line.record.ean = null;
        line.record.rawValues = {
          ...line.record.rawValues,
          businessDate: "2026-10-21",
          itm8: line.record.itm8,
          ean: null,
        };
        return line;
      }),
    );
    original.businessPeriodStart = original.businessPeriodEnd = "2026-10-21";
    const first = await repository.publish({
      ...input(original, `sha256:${"1".repeat(64)}`),
      filename: "21102026.xlsx",
    });
    const corrected = structuredClone(original);
    corrected.lines[23]!.record.quantity = 2.5;
    corrected.lines[23]!.record.rawValues.quantity = 2.5;
    corrected.lines[23]!.match = match("NO_MATCH");
    corrected.readyCount = 23;
    corrected.productReviewCount = 1;
    const blocked = await repository.analyzeOverlap(storeId, corrected);
    expect(blocked?.safeToApply).toBe(false);
    expect(
      blocked?.rows.some(
        (r) =>
          r.reason === "UNRESOLVED_PRODUCT" && r.incomingSourceIndex === 31,
      ),
    ).toBe(true);
    const snapshot = () => ({
      observations: database
        .prepare("SELECT * FROM sales_observations ORDER BY id")
        .all(),
      outbox: database
        .prepare("SELECT * FROM sync_outbox ORDER BY command_id")
        .all(),
      sources: database
        .prepare("SELECT * FROM source_documents ORDER BY id")
        .all(),
    });
    const before = snapshot();
    await expect(
      repository.publish({
        ...input(corrected, `sha256:${"2".repeat(64)}`),
        filename: "21102026.xlsx",
        reconciliationApproval: {
          fingerprint: blocked!.fingerprint,
          actorUserId: "99999999-9999-4999-8999-999999999999",
        },
      }),
    ).rejects.toThrow("Ambiguous reconciliation cannot be applied");
    expect(snapshot()).toEqual(before);
    const products = new ProductMasterRepository(adapter);
    await confirmMercalysProductMapping(
      products,
      buildMercalysProductResolutions(corrected)[0]!,
      ids[23]!,
      {
        storeId,
        deviceId: "88888888-8888-4888-8888-888888888888",
        now,
        generateId,
      },
    );
    const [catalogProducts, identifiers, aliases] = await Promise.all([
      products.listProducts(storeId),
      products.listIdentifiersByStore(storeId),
      products.listAliasesByStore(storeId),
    ]);
    const resolved = rematchMercalysImport(corrected, storeId, {
      products: catalogProducts.map((p) => p.entity),
      identifiers: identifiers.map((p) => p.entity),
      aliases: aliases.map((p) => p.entity),
    });
    expect(resolved.productReviewCount).toBe(0);
    const review = await repository.analyzeOverlap(storeId, resolved);
    expect(review).toMatchObject({
      safeToApply: true,
      counts: { UNCHANGED: 23, MODIFIED: 1, AMBIGUOUS: 0 },
    });
    expect(review!.fingerprint).not.toBe(blocked!.fingerprint);
    const result = await repository.publish({
      ...input(resolved, `sha256:${"2".repeat(64)}`),
      filename: "21102026.xlsx",
      reconciliationApproval: {
        fingerprint: review!.fingerprint,
        actorUserId: "99999999-9999-4999-8999-999999999999",
      },
    });
    expect(result).toMatchObject({ publishedCount: 24, replacedCount: 24 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS n FROM sales_observations WHERE deleted_at IS NULL",
        )
        .get(),
    ).toEqual({ n: 24 });
    expect(
      database
        .prepare(
          "SELECT quantity FROM sales_observations WHERE product_id=? AND deleted_at IS NULL",
        )
        .get(ids[23]!),
    ).toEqual({ quantity: "2.5" });
    expect(
      database
        .prepare("SELECT COUNT(*) AS n FROM source_documents WHERE id=?")
        .get(first.sourceDocumentId),
    ).toEqual({ n: 1 });
    for (const command of before.outbox)
      expect(
        database
          .prepare("SELECT command_id FROM sync_outbox WHERE command_id=?")
          .get(command.command_id as string),
      ).toBeDefined();
    await expect(
      repository.publish({
        ...input(resolved, `sha256:${"2".repeat(64)}`),
        filename: "21102026.xlsx",
      }),
    ).rejects.toBeInstanceOf(MercalysExactDuplicateError);
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
        "sha256:f116abe9beabcda5cc0a94a433e6a0c17209aed12cb06cbfada03bc1a111c205",
      ),
    );
    const corrected = reconciliationSummary([matchedLine(8, productId, 5)]);
    const reconciliation = await repository.analyzeOverlap(storeId, corrected);

    await repository.keepExisting({
      storeId,
      filename: "corrected.xlsx",
      checksum:
        "sha256:6304f6e31c3d0e7e18ed7eb925b63a8fe470c114cabfb9ae0d27636139a15885",
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
  await adapter.runAsync(
    "INSERT INTO app_metadata(key,value,updated_at) VALUES('device_id',?,?)",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    timestamp,
  );
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
        ) VALUES (?, ?, 'MERCALYS_SALES', 'failed.xlsx', 'sha256:cf16da1864acaf650d969fe8eb470ac1c442324921eaff19a77692f7ec4ff542', ?, 'FAILED', 1, ?, ?, 'ERROR', 1)
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
  checksum = "sha256:cf16da1864acaf650d969fe8eb470ac1c442324921eaff19a77692f7ec4ff542",
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
  nextRecord.itm8 = matchedProductId.slice(-8);
  nextRecord.ean = matchedProductId.slice(-13);
  nextRecord.rawValues.itm8 = nextRecord.itm8;
  nextRecord.rawValues.ean = nextRecord.ean;
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
