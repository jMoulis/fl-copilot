import { randomUUID } from "node:crypto";
import { MongoClient, Decimal128, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildProductDailyPerformance } from "@fl-copilot/analytics-core";
import { productSchema, type Product } from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import { syncPullQuerySchema } from "@fl-copilot/sync-contracts";
import { runMongoMigrations } from "../src/database/migrations";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { refreshProductUnits } from "../src/analytics/product-unit-refresh";
import { createMongoRemoteAnalyticsRepository } from "../src/analytics/remote-confirmation";
import { readAnalyticsQuery } from "../src/copilot/analytics-query-tool";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
} from "../../../scripts/test-mercalys-sync-fixtures";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import {
  loadProductEditorSnapshot,
  productSnapshotToDraft,
  saveProductEditorLocally,
} from "../../mobile/src/products/product-editor-service";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "product unit → durable canonical analytics refresh",
  () => {
    let client: MongoClient, db: Db;
    let clock = new Date("2026-10-23T18:00:00.000Z");
    const now = () => clock;
    const database = {
      getDb: async () => db,
      close: async () => {},
      checkHealth: async () => "connected" as const,
    };
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_unit_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });

    async function fixture(days = 3, unit: Product["salesUnit"] = "UNKNOWN") {
      clock = new Date("2026-10-23T18:00:00.000Z");
      const product: Product = {
        id: randomUUID(),
        storeId: randomUUID(),
        label: "Tomate",
        category: "VEGETABLE",
        nature: "BULK",
        salesUnit: unit,
        packaging: null,
        familyId: null,
        subfamilyId: null,
        status: "ACTIVE",
        version: 1,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
        deletedAt: null,
      };
      const { id, ...rest } = product;
      await db
        .collection<Document & { _id: string }>("products")
        .insertOne({ ...rest, _id: id, createdAt: now(), updatedAt: now() });
      const dates = Array.from({ length: days }, (_, i) =>
        new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      );
      for (const date of dates) {
        const sales = {
          id: randomUUID(),
          storeId: product.storeId,
          productId: id,
          businessDate: date,
          quantity: "1.25",
          purchaseValue: "1",
          salesValue: "3",
          marginValue: "2",
          marginRate: null,
          sourceRecordId: randomUUID(),
          validationStatus: "VALIDATED" as const,
          version: 1,
          updatedAt: product.updatedAt,
          deletedAt: null,
        };
        const waste = {
          id: randomUUID(),
          storeId: product.storeId,
          productId: id,
          businessDate: date,
          quantity: "0.25",
          purchaseValueKnown: "0.2",
          purchaseValueEstimated: null,
          salesValue: "0.5",
          costQuality: "KNOWN" as const,
          sourceRecordId: randomUUID(),
          validationStatus: "VALIDATED" as const,
          version: 1,
          updatedAt: product.updatedAt,
          deletedAt: null,
        };
        const { id: salesId, businessDate: salesDate, ...salesFields } = sales;
        await db
          .collection<Document & { _id: string }>("salesObservations")
          .insertOne({
            ...salesFields,
            _id: salesId,
            date: salesDate,
            quantity: Decimal128.fromString(sales.quantity),
            purchaseValue: Decimal128.fromString(sales.purchaseValue),
            salesValue: Decimal128.fromString(sales.salesValue),
            marginValue: Decimal128.fromString(sales.marginValue),
            updatedAt: now(),
          });
        const { id: wasteId, businessDate: wasteDate, ...wasteFields } = waste;
        await db
          .collection<Document & { _id: string }>("wasteObservations")
          .insertOne({
            ...wasteFields,
            _id: wasteId,
            date: wasteDate,
            quantity: Decimal128.fromString(waste.quantity),
            purchaseValueKnown: Decimal128.fromString(waste.purchaseValueKnown),
            salesValue: Decimal128.fromString(waste.salesValue),
            updatedAt: now(),
          });
        const performance = buildProductDailyPerformance({
          product,
          businessDate: date,
          salesObservations: [sales],
          wasteObservations: [waste],
          commercialOperationIds: [randomUUID()],
          merchandisingPlanIds: [randomUUID()],
          contextEventIds: [randomUUID()],
          marketSignalIds: [randomUUID()],
          storeProductEventIds: [randomUUID()],
          weatherRecordId: randomUUID(),
          computedAt: product.updatedAt,
        });
        await db
          .collection<Document & { _id: string }>("productDailyPerformance")
          .insertOne({
            _id: `product-day:${product.storeId}:${id}:${date}`,
            storeId: product.storeId,
            productId: id,
            date,
            performance,
            origin: "REMOTE",
            formulaVersion: performance.formulaVersion,
            inputRevision: performance.inputRevision,
            computedAt: now(),
          });
      }
      const raw = async () =>
        JSON.stringify(
          await Promise.all(
            ["salesObservations", "wasteObservations"].map((collection) =>
              db
                .collection(collection)
                .find({ storeId: product.storeId })
                .sort({ _id: 1 })
                .toArray(),
            ),
          ),
        );
      const snapshots = () =>
        db
          .collection("productDailyPerformance")
          .find({ storeId: product.storeId })
          .sort({ date: 1 })
          .toArray();
      return { product, dates, raw, snapshots };
    }

    function command(
      product: Product,
      salesUnit: Product["salesUnit"],
      version = product.version,
    ): SyncCommand {
      return {
        commandId: randomUUID(),
        localSequence: version,
        type: "PRODUCT_UPSERT",
        entityType: "product",
        entityId: product.id,
        expectedRemoteVersion: version,
        createdAt: now().toISOString(),
        payload: {
          ...product,
          salesUnit,
          version: version + 1,
          updatedAt: now().toISOString(),
        },
      };
    }
    async function push(product: Product, change: SyncCommand) {
      return createMongoSyncPushService(database, now).push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: product.id,
          storeId: product.storeId,
          commands: [change],
        },
        "unit-refresh-test",
      );
    }

    it("refreshes quantities/prices through a real SQLite editor/Outbox command, retaining raw values and context", async () => {
      const f = await fixture();
      const before = await f.snapshots(),
        original = await f.raw();
      const local = new MercalysTestDatabase();
      try {
        await mercalysLocalFixture(local, f.product.storeId, f.product.id);
        await local.runAsync(
          "UPDATE products SET sales_unit='UNKNOWN' WHERE id=?",
          f.product.id,
        );
        const repo = new ProductMasterRepository(local);
        const snapshot = (await loadProductEditorSnapshot(repo, f.product.id))!;
        await saveProductEditorLocally(
          local,
          { ...productSnapshotToDraft(snapshot), salesUnit: "KG" },
          {
            storeId: f.product.storeId,
            deviceId: f.product.id,
            productId: f.product.id,
            now: () => now().toISOString(),
            generateId: randomUUID,
          },
          snapshot,
        );
        const queued = await new OutboxRepository(local).listPending(
          f.product.storeId,
        );
        expect(queued).toHaveLength(1);
        const c = queued[0]!;
        const result = await push(f.product, {
          commandId: c.commandId,
          localSequence: c.localSequence,
          type: c.commandType,
          entityType: c.entityType,
          entityId: c.entityId,
          expectedRemoteVersion: c.expectedRemoteVersion,
          createdAt: c.createdAt,
          payload: { ...productSchema.parse(c.payload) },
        });
        expect(result.results[0]!.status).toBe("APPLIED");
        expect(result.results[0]!.remoteEntity).not.toHaveProperty(
          "analyticsRefresh",
        );
        const after = await f.snapshots();
        for (let i = 0; i < after.length; i++) {
          expect(after[i]!.performance.sales).toMatchObject({
            quantity: "1.25",
            quantityUnit: "KG",
            salesValue: "3.00",
            marginValue: "2.00",
          });
          expect(after[i]!.performance.waste).toMatchObject({
            quantity: "0.25",
            quantityUnit: "KG",
            salesValue: "0.50",
          });
          for (const key of [
            "commercialOperationIds",
            "merchandisingPlanIds",
            "contextEventIds",
            "marketSignalIds",
            "storeProductEventIds",
            "weatherRecordId",
            "sourceLineageIds",
          ])
            expect(after[i]!.performance[key]).toEqual(
              before[i]!.performance[key],
            );
        }
        expect(await f.raw()).toBe(original);
        expect(
          await db
            .collection("products")
            .findOne({ storeId: f.product.storeId }),
        ).not.toHaveProperty("analyticsRefresh");
        const query = await readAnalyticsQuery(db, f.product.storeId, {
          currentPeriod: { start: f.dates[0], end: f.dates[2] },
          referencePeriod: null,
          groupBy: "PRODUCT",
          metrics: ["sales"],
          aggregation: "SUM",
          filters: {
            productIds: [f.product.id],
            labelContains: null,
            category: null,
            nature: null,
          },
          having: null,
          sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
          offset: 0,
          limit: 10,
          includeSalesMeasures: true,
        });
        expect(query.rows[0]!.salesMeasures!.current).toMatchObject({
          quantity: { value: "3.75" },
          averageRealizedPrice: { value: "2.40" },
        });
      } finally {
        local.db.close();
      }
    });

    it("checkpoints a bounded historical page and resumes through ordinary pull without any workflow provider", async () => {
      const f = await fixture(80);
      const original = await f.raw(),
        change = command(f.product, "KG");
      expect((await push(f.product, change)).results[0]!.status).toBe(
        "APPLIED",
      );
      const queued = await db
        .collection("products")
        .findOne({ storeId: f.product.storeId });
      expect(queued!.analyticsRefresh.afterDate).toBe(f.dates[63]);
      expect(
        (await f.snapshots()).filter(
          (p) => p.performance.sales.quantityUnit === "KG",
        ),
      ).toHaveLength(64);
      const partial = await readAnalyticsQuery(db, f.product.storeId, {
        currentPeriod: { start: f.dates[0], end: f.dates[79] },
        referencePeriod: null,
        groupBy: "PRODUCT",
        metrics: ["sales"],
        aggregation: "SUM",
        filters: {
          productIds: [f.product.id],
          labelContains: null,
          category: null,
          nature: null,
        },
        having: null,
        sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
        offset: 0,
        limit: 10,
        includeSalesMeasures: true,
      });
      expect(partial.rows[0]!.salesMeasures!.current).toMatchObject({
        refreshPendingDays: 16,
        quantity: { status: "PARTIAL", reason: "MISSING_INPUT" },
        averageRealizedPrice: { value: "2.40", pairedDays: 64 },
      });
      expect(
        Number(partial.rows[0]!.salesMeasures!.current.quantity.value),
      ).toBe(80);
      expect(JSON.stringify(partial.evidence)).toContain(
        "en cours d’actualisation",
      );
      const pull = createMongoSyncPullService(database, now);
      await pull.pull(
        f.product.storeId,
        syncPullQuerySchema.parse({ limit: 100 }),
      );
      expect(
        (await f.snapshots()).every(
          (p) => p.performance.sales.quantityUnit === "KG",
        ),
      ).toBe(true);
      expect(
        await db.collection("products").findOne({ storeId: f.product.storeId }),
      ).not.toHaveProperty("analyticsRefresh");
      expect((await push(f.product, change)).results[0]!.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await db
          .collection("processedCommands")
          .countDocuments({ storeId: f.product.storeId }),
      ).toBe(1);
      expect(await f.raw()).toBe(original);
      expect(
        await db
          .collection("departmentDailyPerformance")
          .countDocuments({ storeId: f.product.storeId }),
      ).toBe(0);
    });

    it("does not convert fractional pieces and can return a formerly known unit to UNKNOWN", async () => {
      const f = await fixture(1, "KG"),
        original = await f.raw();
      await push(f.product, command(f.product, "PIECE"));
      expect((await f.snapshots())[0]!.performance.sales).toMatchObject({
        quantity: "1.25",
        quantityUnit: "PIECE",
      });
      await push(f.product, command(f.product, "UNKNOWN", 2));
      expect(
        (await f.snapshots())[0]!.performance.availability.salesQuantity,
      ).toMatchObject({ status: "UNAVAILABLE", reason: "UNKNOWN_UNIT" });
      expect(await f.raw()).toBe(original);
    });

    it("leaves unchanged-unit edits, conflicting versions and foreign-store attempts without recomputation", async () => {
      const f = await fixture(1, "KG"),
        before = await f.snapshots();
      await push(f.product, {
        ...command(f.product, "KG"),
        payload: { ...f.product, label: "Autre libellé", version: 2 },
      });
      expect(await f.snapshots()).toEqual(before);
      expect(
        (await push(f.product, command(f.product, "PIECE"))).results[0]!.status,
      ).toBe("CONFLICT");
      const other = { ...f.product, storeId: randomUUID() };
      expect(
        (await push(other, command(other, "PIECE", 2))).results[0]!.status,
      ).toBe("REJECTED");
      expect(await f.snapshots()).toEqual(before);
      expect(
        await db.collection("products").findOne({ storeId: f.product.storeId }),
      ).not.toHaveProperty("analyticsRefresh");
    });

    it("prevents an older in-flight confirmation from replacing a newer snapshot", async () => {
      const f = await fixture(1),
        scope = { productId: f.product.id, businessDate: f.dates[0]! };
      const oldRepo = createMongoRemoteAnalyticsRepository(database),
        nextRepo = createMongoRemoteAnalyticsRepository(database);
      const old = await oldRepo.loadProductDay(f.product.storeId, scope);
      await db
        .collection("products")
        .updateOne(
          { storeId: f.product.storeId },
          { $set: { salesUnit: "KG", version: 2 } },
        );
      const next = await nextRepo.loadProductDay(f.product.storeId, scope);
      await nextRepo.saveProductDay(
        buildProductDailyPerformance({
          ...next,
          businessDate: scope.businessDate,
          computedAt: now().toISOString(),
        }),
      );
      await expect(
        oldRepo.saveProductDay(
          buildProductDailyPerformance({
            ...old,
            businessDate: scope.businessDate,
            computedAt: now().toISOString(),
          }),
        ),
      ).rejects.toThrow("REMOTE_ANALYTICS_SNAPSHOT_CHANGED");
      expect((await f.snapshots())[0]!.performance.sales.quantityUnit).toBe(
        "KG",
      );
    });

    it("gives a failed page a durable retry without failing the saved product or losing completed checkpoints", async () => {
      const f = await fixture(24),
        original = await f.raw();
      let fail = true;
      const realCollection = db.collection.bind(db);
      const spy = vi.spyOn(db, "collection").mockImplementation(((
        name: string,
        options?: unknown,
      ) => {
        const collection = realCollection(name, options as never);
        if (name === "productDailyPerformance") {
          const replace = collection.replaceOne.bind(collection);
          collection.replaceOne = ((
            filter: Document,
            document: Document,
            ...args: unknown[]
          ) => {
            if (
              fail &&
              document.storeId === f.product.storeId &&
              document.date === f.dates[8]
            )
              return Promise.reject(Error("synthetic interruption"));
            return replace(filter, document, ...(args as []));
          }) as typeof collection.replaceOne;
        }
        return collection;
      }) as Db["collection"]);
      try {
        const result = await push(f.product, command(f.product, "KG"));
        expect(result.results[0]!.status).toBe("APPLIED");
        expect(
          (await realCollection("products").findOne({
            storeId: f.product.storeId,
          }))!.analyticsRefresh.afterDate,
        ).toBe(f.dates[7]);
        expect(
          await refreshProductUnits(database, f.product.storeId, now),
        ).toEqual({ processed: 0, remaining: false });
        fail = false;
        clock = new Date(now().getTime() + 31_000);
        expect(
          await refreshProductUnits(database, f.product.storeId, now),
        ).toEqual({ processed: 16, remaining: false });
        expect(
          (await f.snapshots()).every(
            (p) => p.performance.sales.quantityUnit === "KG",
          ),
        ).toBe(true);
        expect(await f.raw()).toBe(original);
      } finally {
        spy.mockRestore();
      }
    });

    it("claims one product page across concurrent sync attempts and isolates other stores", async () => {
      const a = await fixture(),
        b = await fixture();
      for (const f of [a, b])
        await db.collection("products").updateOne(
          { storeId: f.product.storeId },
          {
            $set: {
              salesUnit: "KG",
              version: 2,
              analyticsRefresh: {
                generation: randomUUID(),
                requestedAt: now(),
                afterDate: null,
                leaseId: null,
                leaseUntil: null,
                retryAt: null,
              },
            },
          },
        );
      const result = await Promise.all([
        refreshProductUnits(database, a.product.storeId, now),
        refreshProductUnits(database, a.product.storeId, now),
      ]);
      expect(result.reduce((sum, r) => sum + r.processed, 0)).toBe(3);
      expect(
        (await a.snapshots()).every(
          (p) => p.performance.sales.quantityUnit === "KG",
        ),
      ).toBe(true);
      expect(
        (await b.snapshots()).every(
          (p) => p.performance.sales.quantityUnit === null,
        ),
      ).toBe(true);
      expect(
        await db.collection("products").findOne({ storeId: b.product.storeId }),
      ).toHaveProperty("analyticsRefresh");
    });
    it("retains a newer unit correction arriving during a running page", async () => {
      const f = await fixture(24);
      const latest = command(f.product, "PIECE", 2);
      let flipped = false;
      const collectionFor = db.collection.bind(db);
      const spy = vi.spyOn(db, "collection").mockImplementation(((
        name: string,
        options?: unknown,
      ) => {
        const collection = collectionFor(name, options as never);
        if (name === "productDailyPerformance") {
          const replace = collection.replaceOne.bind(collection);
          collection.replaceOne = (async (
            filter: Document,
            document: Document,
            ...args: unknown[]
          ) => {
            if (
              !flipped &&
              document.storeId === f.product.storeId &&
              document.date === f.dates[8]
            ) {
              flipped = true;
              expect((await push(f.product, latest)).results[0]!.status).toBe(
                "APPLIED",
              );
            }
            return replace(filter, document, ...(args as []));
          }) as typeof collection.replaceOne;
        }
        return collection;
      }) as Db["collection"]);
      try {
        expect(
          (await push(f.product, command(f.product, "KG"))).results[0]!.status,
        ).toBe("APPLIED");
        expect(flipped).toBe(true);
        const pending = await collectionFor("products").findOne({
          storeId: f.product.storeId,
        });
        expect(pending!.analyticsRefresh).toMatchObject({
          generation: latest.commandId,
          afterDate: null,
          leaseId: null,
        });
        expect(
          await refreshProductUnits(database, f.product.storeId, now),
        ).toEqual({ processed: 24, remaining: false });
        expect(
          (await f.snapshots()).every(
            (p) =>
              p.performance.sales.quantityUnit === "PIECE" &&
              p.performance.inputRevision.includes(`product:${f.product.id}:3`),
          ),
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it("reclaims an interrupted server lease and resumes the persisted checkpoint", async () => {
      const f = await fixture(80);
      await push(f.product, command(f.product, "KG"));
      await db.collection("products").updateOne(
        { storeId: f.product.storeId },
        {
          $set: {
            "analyticsRefresh.leaseId": randomUUID(),
            "analyticsRefresh.leaseUntil": new Date(now().getTime() + 60_000),
          },
        },
      );
      expect(
        await refreshProductUnits(database, f.product.storeId, now),
      ).toEqual({ processed: 0, remaining: false });
      clock = new Date(now().getTime() + 61_000);
      expect(
        await refreshProductUnits(database, f.product.storeId, now),
      ).toEqual({ processed: 16, remaining: false });
      expect(
        (await f.snapshots()).every(
          (p) => p.performance.sales.quantityUnit === "KG",
        ),
      ).toBe(true);
    });
  },
);
