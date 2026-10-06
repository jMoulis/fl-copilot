import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { WasteLine } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { randomUUID } from "node:crypto";
import {
  WasteReceiptPublicationRepository,
  applyWastePublication,
} from "./waste-receipt-publication";
import { applyBootstrap } from "../sync/apply-bootstrap";
import { applyPullPage } from "../sync/apply-pull-page";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "../analytics/local-recomputation";
import { applyWastePublicationCommand } from "../../../api/src/uploads/waste-receipt-publication";
import type { MongoCommandMutationContext } from "../../../api/src/sync/processed-command-service";
import type { createMongoSyncChangeService } from "../../../api/src/sync/sync-change-service";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import { wastePublicationSchema } from "@fl-copilot/sync-contracts";
import { WasteReceiptRepository } from "./waste-receipt-repository";

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
const receiptId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const sourceDocumentId = "55555555-5555-4555-8555-555555555555";
const uploadJobId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-10-04T16:00:00.000Z";

function line(overrides: Partial<WasteLine> = {}): WasteLine {
  return {
    id: lineId,
    storeId,
    receiptId,
    sourceLineIndex: 0,
    rawLabel: "TOMATE VRAC",
    quantity: null,
    weight: "1.25",
    quantityUnit: "KG",
    unitPrice: "3.50",
    totalPrice: "4.38",
    matchedProductId: null,
    matchStatus: "UNMATCHED",
    matchConfidence: null,
    productNature: "UNKNOWN",
    extractionConfidence: { rawLabel: 0.98 },
    sourceRegion: { page: 1, x: 0.1, y: 0.2 },
    validationStatus: "TO_REVIEW",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncState: "LOCAL_ONLY",
    remoteVersion: null,
    dirty: true,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const productId = "77777777-7777-4777-8777-777777777777";
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "fl-waste-publish-"));
  directories.push(directory);
  const path = join(directory, "local.db");
  const db = new DatabaseSync(path);
  const adapter = new NodeDatabase(db);
  await runLocalMigrations(adapter);
  db.prepare(
    `INSERT INTO products (id, store_id, label, category, nature, sales_unit, status, version, created_at, updated_at, sync_state, dirty) VALUES (?, ?, 'TOMATE VRAC', 'VEGETABLE', 'BULK', 'KG', 'ACTIVE', 1, ?, ?, 'SYNCED', 0)`,
  ).run(productId, storeId, timestamp, timestamp);
  const repo = new WasteReceiptRepository(adapter);
  await repo.createCapturedDraft({
    receiptId,
    fileId,
    sourceDocumentId,
    uploadJobId,
    storeId,
    capturedAt: timestamp,
    file: {
      originalFilename: "ticket.jpg",
      localUri: "file:///ticket.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      checksum: "sha256:receipt",
    },
  });
  db.prepare(
    "UPDATE source_documents SET remote_upload_status = 'CONFIRMED' WHERE id = ?",
  ).run(sourceDocumentId);
  db.prepare(
    "UPDATE waste_receipts SET processing_status = 'TO_VALIDATE', confirmed_waste_date = '2026-10-03' WHERE id = ?",
  ).run(receiptId);
  const value = line({
    matchedProductId: productId,
    matchStatus: "MATCHED",
    productNature: "BULK",
    validationStatus: "PENDING",
  });
  // Use the production line serializer under the same foreign-key constraints.
  const { insertLine } = await import("./waste-receipt-repository");
  await insertLine(adapter, value);
  return {
    db,
    adapter,
    path,
    repo,
    publisher: new WasteReceiptPublicationRepository(adapter),
  };
}
function input() {
  return {
    receiptId,
    storeId,
    deviceId: randomUUID(),
    commandId: randomUUID(),
    analyticsJobId: randomUUID(),
    timestamp,
  };
}
function payload(db: DatabaseSync) {
  return wastePublicationSchema.parse(
    JSON.parse(
      (
        db.prepare("SELECT payload_json FROM sync_outbox").get() as {
          payload_json: string;
        }
      ).payload_json,
    ),
  );
}

describe("Waste receipt atomic publication", () => {
  it("reports all blocking fields across lines and keeps publication atomic", async () => {
    const { db, adapter, publisher } = await setup();
    db.exec(
      "UPDATE waste_lines SET weight = NULL, total_price = NULL; UPDATE waste_receipts SET confirmed_waste_date = NULL",
    );
    const { insertLine } = await import("./waste-receipt-repository");
    const secondId = randomUUID();
    await insertLine(adapter, line({ id: secondId, sourceLineIndex: 1 }));
    const issues = await publisher.validate(receiptId, storeId);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "date" }),
        expect.objectContaining({ lineId, field: "weight" }),
        expect.objectContaining({ lineId, field: "totalPrice" }),
        expect.objectContaining({ lineId: secondId, field: "product" }),
      ]),
    );
    const { WastePublicationValidationError } =
      await import("./waste-publication-validation");
    await expect(publisher.publish(input())).rejects.toBeInstanceOf(
      WastePublicationValidationError,
    );
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM waste_observations").get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
    ).toEqual({ count: 0 });
    db.close();
  });
  it("identifies catalog incompleteness, permits explicit reconfirmation and clears blockers after correction", async () => {
    const { db, publisher, repo } = await setup();
    db.exec(
      "UPDATE products SET nature = 'UNKNOWN', sales_unit = 'UNKNOWN', status = 'TO_REVIEW'",
    );
    expect(await publisher.validate(receiptId, storeId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineId,
          field: "product",
          message: expect.stringContaining("actif"),
        }),
        expect.objectContaining({
          field: "product",
          message: expect.stringContaining("Vrac"),
        }),
        expect.objectContaining({
          field: "product",
          message: expect.stringContaining("unité"),
        }),
      ]),
    );
    db.exec(
      "UPDATE products SET nature = 'PACKAGED', sales_unit = 'PACK', status = 'ACTIVE'",
    );
    expect(await publisher.validate(receiptId, storeId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "product",
          message: expect.stringContaining("Reconfirmez"),
        }),
        expect.objectContaining({ field: "quantityUnit" }),
        expect.objectContaining({ field: "quantity" }),
      ]),
    );
    await repo.selectProductCandidate(receiptId, lineId, productId);
    await repo.updateLineValues(receiptId, lineId, {
      rawLabel: "TOMATE CONDITIONNÉE",
      weight: null,
      quantity: "2",
      quantityUnit: "PACK",
      unitPrice: null,
      totalPrice: "4.38",
    });
    expect(await publisher.validate(receiptId, storeId)).toEqual([]);
    expect(await publisher.publish(input())).toEqual({ publishedCount: 1 });
    db.close();
  });
  it("highlights each arithmetic input, and ignores excluded occurrences", async () => {
    const { db, publisher, repo } = await setup();
    db.exec("UPDATE waste_lines SET total_price = '99'");
    const issues = await publisher.validate(receiptId, storeId);
    expect(
      issues.filter((i) => i.lineId === lineId).map((i) => i.field),
    ).toEqual(expect.arrayContaining(["weight", "unitPrice", "totalPrice"]));
    await repo.setLineExcluded(receiptId, lineId, true);
    expect(await publisher.validate(receiptId, storeId)).toEqual([
      expect.objectContaining({ field: "lines" }),
    ]);
    db.close();
  });

  it("publishes a packaged quantity with its own unit and keeps excluded occurrences out of observations", async () => {
    const { db, adapter, publisher, repo } = await setup();
    db.exec(
      "UPDATE products SET nature = 'PACKAGED', sales_unit = 'PACK'; UPDATE waste_lines SET product_nature = 'PACKAGED', weight = NULL, quantity = '2', quantity_unit = 'PACK', unit_price = NULL, total_price = '4.38'",
    );
    const { insertLine } = await import("./waste-receipt-repository");
    const excludedId = randomUUID();
    await insertLine(adapter, line({ id: excludedId, sourceLineIndex: 1 }));
    await repo.setLineExcluded(receiptId, excludedId, true);
    await publisher.publish(input());
    expect(
      db
        .prepare("SELECT quantity, product_nature FROM waste_observations")
        .get(),
    ).toEqual({ quantity: "2", product_nature: "PACKAGED" });
    expect(payload(db).lines).toHaveLength(2);
    expect(payload(db).observations).toHaveLength(1);
    db.close();
  });

  it("publishes once, preserves the source, recomputes waste without inventing sales or purchase cost and survives restart", async () => {
    const { db, adapter, publisher, path, repo } = await setup();
    expect(await publisher.publish(input())).toEqual({ publishedCount: 1 });
    expect(await publisher.publish(input())).toEqual({ publishedCount: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT quantity, sales_value, purchase_value_known, cost_quality FROM waste_observations",
        )
        .get(),
    ).toEqual({
      quantity: "1.25",
      sales_value: "4.38",
      purchase_value_known: null,
      cost_quality: "UNAVAILABLE",
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sales_observations").get(),
    ).toEqual({ count: 0 });
    await new LocalAnalyticsRecomputationScheduler(
      adapter,
      new SQLiteProductDateRecomputer(adapter),
    ).process(storeId);
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM product_daily_performance")
        .get(),
    ).toEqual({ count: 1 });
    await expect(
      repo.confirmWasteDate(receiptId, "2026-10-04"),
    ).rejects.toThrow("WASTE_RECEIPT_READ_ONLY");
    const p = payload(db);
    expect(p.source.localFileUri).toBeNull();
    expect(p.receipt.localFileId).toBeNull();
    db.close();
    const reopened = new DatabaseSync(path);
    expect(
      reopened.prepare("SELECT processing_status FROM waste_receipts").get(),
    ).toEqual({ processing_status: "PUBLISHED" });
    expect(reopened.prepare("SELECT local_uri FROM local_files").get()).toEqual(
      { local_uri: "file:///ticket.jpg" },
    );
    reopened.close();
  });
  it.each(["date", "product", "arithmetic", "quantity", "duplicate"])(
    "blocks %s failures without publishing any partial state",
    async (reason) => {
      const { db, publisher } = await setup();
      if (reason === "date")
        db.exec("UPDATE waste_receipts SET confirmed_waste_date = NULL");
      if (reason === "product")
        db.exec(
          "UPDATE waste_lines SET matched_product_id = NULL, match_status = 'UNMATCHED'",
        );
      if (reason === "arithmetic")
        db.exec("UPDATE waste_lines SET total_price = '9.99'");
      if (reason === "quantity")
        db.exec("UPDATE waste_lines SET weight = NULL");
      if (reason === "duplicate")
        db.exec(
          "UPDATE waste_receipts SET duplicate_status = 'POSSIBLE_DUPLICATE'",
        );
      await expect(publisher.publish(input())).rejects.toThrow();
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM waste_observations").get(),
      ).toEqual({ count: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 0 });
      db.close();
    },
  );
  it("rolls back observations when the Outbox fails", async () => {
    const { db, publisher } = await setup();
    db.exec(
      "CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END",
    );
    await expect(publisher.publish(input())).rejects.toThrow("outbox failed");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM waste_observations").get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT processing_status FROM waste_receipts").get(),
    ).toEqual({ processing_status: "TO_VALIDATE" });
    db.close();
  });
  it("acknowledges and restores published receipts via pull and a fresh-device bootstrap", async () => {
    const { db, adapter, publisher } = await setup();
    await publisher.publish(input());
    const p = payload(db);
    const entity = { id: receiptId, storeId, remoteVersion: 1, publication: p };
    await adapter.withExclusiveTransactionAsync((tx) =>
      applyWastePublication(tx, storeId, entity),
    );
    expect(
      db.prepare("SELECT sync_state, dirty FROM waste_receipts").get(),
    ).toEqual({ sync_state: "SYNCED", dirty: 0 });
    const second = await setup();
    second.db.exec(
      "DELETE FROM waste_lines; DELETE FROM waste_receipts; DELETE FROM local_jobs; DELETE FROM local_files; DELETE FROM source_documents;",
    );
    await applyPullPage(second.adapter, storeId, {
      changes: [
        {
          sequence: "1",
          entityType: "waste_receipt_publication",
          entityId: receiptId,
          entityVersion: 1,
          operation: "UPSERT",
          entity,
          changedAt: timestamp,
        },
      ],
      nextCursor: "cursor",
      hasMore: false,
      serverTime: timestamp,
    });
    expect(
      second.db
        .prepare("SELECT COUNT(*) AS count FROM waste_observations")
        .get(),
    ).toEqual({ count: 1 });
    const { bootstrapResponseSchema } =
      await import("@fl-copilot/sync-contracts");
    const names = [
      "syncTestEntities",
      "products",
      "productIdentifiers",
      "productAliases",
      "needUnits",
      "needMemberships",
      "productSubstitutions",
      "salesObservations",
      "wasteObservations",
      "commercialOperations",
      "offers",
      "marketSignals",
      "executionInstructions",
      "storeEvents",
      "productDailyPerformance",
      "departmentDailyPerformance",
      "recommendations",
      "decisions",
      "actionExecutions",
    ];
    const bootstrap = bootstrapResponseSchema.parse({
      protocolVersion: 1,
      store: { id: storeId },
      snapshotRevision: "test",
      cursor: "cursor",
      historyPolicy: { rawObservationDays: 90 },
      entities: {
        ...Object.fromEntries(names.map((n) => [n, []])),
        wasteReceiptPublications: [entity],
      },
      serverTime: timestamp,
    });
    await applyBootstrap(second.adapter, storeId, bootstrap);
    expect(
      second.db
        .prepare("SELECT COUNT(*) AS count FROM waste_observations")
        .get(),
    ).toEqual({ count: 1 });
    second.db.close();
    db.close();
  });
  it("publishes server-side once and rejects forged lineage or quantity", async () => {
    const { db, publisher } = await setup();
    await publisher.publish(input());
    const p = payload(db);
    const collections = new Map<string, Record<string, unknown>[]>();
    collections.set("products", [
      {
        _id: productId,
        storeId,
        nature: "BULK",
        salesUnit: "KG",
        status: "ACTIVE",
        deletedAt: null,
      },
    ]);
    collections.set("sourceDocuments", [
      {
        _id: sourceDocumentId,
        storeId,
        sourceType: "WASTE_RECEIPT",
        remoteUploadStatus: "CONFIRMED",
        checksum: p.source.checksum,
      },
    ]);
    const context = {
      database: {
        collection(name: string) {
          const rows = collections.get(name) ?? [];
          collections.set(name, rows);
          return {
            async findOne(filter: Record<string, unknown>) {
              return (
                rows.find((row) =>
                  Object.entries(filter).every(([k, v]) => row[k] === v),
                ) ?? null
              );
            },
            async updateOne() {},
            async insertOne(value: Record<string, unknown>) {
              rows.push(value);
            },
          };
        },
      },
      session: {},
    } as unknown as MongoCommandMutationContext;
    const changes = { async append() {} } as unknown as ReturnType<
      typeof createMongoSyncChangeService
    >;
    const command: SyncCommand = {
      commandId: randomUUID(),
      localSequence: 1,
      type: "WASTE_RECEIPT_PUBLISH",
      entityType: "waste_receipt_publication",
      entityId: receiptId,
      expectedRemoteVersion: null,
      createdAt: timestamp,
      payload: JSON.parse(JSON.stringify(p)),
    };
    const forged = structuredClone(p);
    forged.observations[0]!.quantity = "100";
    expect(
      (
        await applyWastePublicationCommand(
          context,
          storeId,
          { ...command, payload: JSON.parse(JSON.stringify(forged)) },
          "test",
          changes,
        )
      ).resultStatus,
    ).toBe("REJECTED");
    expect(collections.get("wasteObservations") ?? []).toHaveLength(0);
    expect(
      (
        await applyWastePublicationCommand(
          context,
          storeId,
          command,
          "test",
          changes,
        )
      ).resultStatus,
    ).toBe("APPLIED");
    expect(
      (
        await applyWastePublicationCommand(
          context,
          storeId,
          command,
          "test",
          changes,
        )
      ).resultStatus,
    ).toBe("APPLIED");
    expect(collections.get("wasteObservations")).toHaveLength(1);
    const tampered = structuredClone(p);
    tampered.observations[0]!.quantity = "100";
    expect(
      (
        await applyWastePublicationCommand(
          context,
          storeId,
          { ...command, payload: JSON.parse(JSON.stringify(tampered)) },
          "test",
          changes,
        )
      ).resultStatus,
    ).toBe("CONFLICT");
    expect(
      wastePublicationSchema.safeParse({
        ...p,
        source: { ...p.source, storeId: randomUUID() },
      }).success,
    ).toBe(false);
    db.close();
  });
});

const integrationIt =
  process.env.TEST_MONGODB_URI &&
  process.env.TEST_MONGODB_TRANSACTIONS === "true"
    ? it
    : it.skip;
integrationIt(
  "commits a real MongoDB publication and recovers it with incremental pull and bootstrap",
  async () => {
    const { createMongoDatabase } =
      await import("../../../api/src/database/mongo");
    const { parseEnvironment } = await import("../../../api/src/config");
    const { createMongoSyncPushService } =
      await import("../../../api/src/sync/push-service");
    const { createMongoSyncPullService } =
      await import("../../../api/src/sync/pull-service");
    const { createMongoSyncBootstrapService } =
      await import("../../../api/src/sync/bootstrap-service");
    const remote = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: process.env.TEST_MONGODB_URI,
        MONGODB_DATABASE: `flc_m4_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      }),
    );
    const local = await setup();
    try {
      await local.publisher.publish(input());
      const p = payload(local.db);
      const db = await remote.getDb();
      await db
        .collection<{ _id: string; [key: string]: unknown }>("products")
        .insertOne({
          _id: productId,
          storeId,
          label: "TOMATE VRAC",
          category: "VEGETABLE",
          nature: "BULK",
          salesUnit: "KG",
          status: "ACTIVE",
          version: 1,
          createdAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
          deletedAt: null,
        });
      await db
        .collection<{ _id: string; [key: string]: unknown }>("sourceDocuments")
        .insertOne({
          _id: sourceDocumentId,
          storeId,
          sourceType: "WASTE_RECEIPT",
          remoteUploadStatus: "CONFIRMED",
          checksum: p.source.checksum,
        });
      const push = createMongoSyncPushService(remote);
      const request = {
        syncProtocolVersion: 1 as const,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "WASTE_RECEIPT_PUBLISH",
            entityType: "waste_receipt_publication",
            entityId: receiptId,
            expectedRemoteVersion: null,
            createdAt: timestamp,
            payload: JSON.parse(JSON.stringify(p)),
          },
        ],
      };
      expect((await push.push(request, "test")).results[0]?.status).toBe(
        "APPLIED",
      );
      expect((await push.push(request, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await db.collection("wasteObservations").countDocuments({ storeId }),
      ).toBe(1);
      expect(
        await db.collection("salesObservations").countDocuments({ storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("productDailyPerformance")
          .countDocuments({ storeId }),
      ).toBe(1);
      const page = await createMongoSyncPullService(remote).pull(storeId, {
        limit: 500,
      });
      expect(page.changes[0]?.entityType).toBe("waste_receipt_publication");
      const second = await setup();
      second.db.exec(
        "DELETE FROM waste_lines; DELETE FROM waste_receipts; DELETE FROM local_jobs; DELETE FROM local_files; DELETE FROM source_documents;",
      );
      try {
        await applyPullPage(second.adapter, storeId, page);
        const snapshot = await createMongoSyncBootstrapService(
          remote,
        ).bootstrap(
          {
            userId: randomUUID(),
            sessionId: randomUUID(),
            deviceId: randomUUID(),
            storeId,
            storeName: "Test",
            role: "MANAGER",
          },
          { rawObservationDays: 90 },
        );
        await applyBootstrap(second.adapter, storeId, snapshot);
        expect(
          second.db
            .prepare("SELECT COUNT(*) AS count FROM waste_observations")
            .get(),
        ).toEqual({ count: 1 });
      } finally {
        second.db.close();
      }
    } finally {
      local.db.close();
      const db = await remote.getDb();
      await db.dropDatabase();
      await remote.close();
    }
  },
  30000,
);
