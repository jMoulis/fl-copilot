import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
  mercalysWorkbook,
  mercalysTimestamp,
} from "../../../scripts/test-mercalys-sync-fixtures";
import { MercalysImportPublicationRepository } from "../../mobile/src/documents/mercalys-import-publication";
import {
  readMercalysPublication,
  repairMercalysPublications,
} from "../../mobile/src/documents/mercalys-publication-sync";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { createMongoImportVerificationService } from "../src/imports/import-verification-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
} from "@fl-copilot/sync-contracts";
import { fingerprintMercalysRecords } from "@fl-copilot/import-core";
import { readMercalysPeriodAudit } from "../src/copilot/mercalys-period-audit";
import { readPeriodAnalysis } from "../src/copilot/period-analysis-tool";
import { runMongoMigrations } from "../src/database/migrations";
import { SQLiteProductDateRecomputer } from "../../mobile/src/analytics/local-recomputation";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "Mercalys approved SQLite rows → Mongo → Copilot → another device",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db(
        `fl_mercalys_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    it("restarts, backfills published sales and historical waste, retries once, restores and calculates without double-counting", async () => {
      const directory = mkdtempSync(join(tmpdir(), "fl-mercalys-e2e-")),
        path = join(directory, "phone.db");
      let device = new MercalysTestDatabase(new DatabaseSync(path));
      const other = new MercalysTestDatabase();
      const storeId = randomUUID(),
        productId = randomUUID(),
        ownerId = randomUUID();
      const blobs = new Map<string, Uint8Array>();
      try {
        await mercalysLocalFixture(device, storeId, productId);
        const product = await device.getFirstAsync<Record<string, unknown>>(
          "SELECT * FROM products WHERE id=?",
          productId,
        );
        await db.collection<Document & { _id: string }>("products").insertOne({
          _id: productId,
          storeId,
          label: "Tomate",
          category: "VEGETABLE",
          nature: "BULK",
          salesUnit: "KG",
          status: "ACTIVE",
          version: 1,
          createdAt: new Date(mercalysTimestamp),
          updatedAt: new Date(mercalysTimestamp),
          deletedAt: null,
        });
        void product;
        const service = {
          getDb: async () => db,
          checkHealth: async () => "connected" as const,
          close: async () => {},
        };
        const reader = { read: async (key: string) => blobs.get(key) ?? null };
        const push = createMongoSyncPushService(
            service,
            () => new Date(mercalysTimestamp),
            reader,
          ),
          pull = createMongoSyncPullService(service),
          bootstrap = createMongoSyncBootstrapService(service);
        const scope = {
          storeId,
          userId: ownerId,
          sessionId: randomUUID(),
          deviceId: randomUUID(),
          storeName: "Pilote",
          role: "MANAGER" as const,
        };
        const sent: Parameters<typeof push.push>[0][] = [];
        const transport = {
          push: (request: Parameters<typeof push.push>[0]) => {
            sent.push(request);
            return push.push(request, randomUUID(), ownerId);
          },
          pull: (id: string, cursor?: string) =>
            pull.pull(
              id,
              syncPullQuerySchema.parse({
                cursor,
                mercalysPublications: "true",
              }),
            ),
          bootstrap: () =>
            bootstrap.bootstrap(
              scope,
              bootstrapQuerySchema.parse({ mercalysPublications: "true" }),
            ),
        };
        const publish = async (
          flow: "MERCALYS_SALES" | "MERCALYS_WASTE",
          date: string,
          sales?: number,
        ) => {
          const f = mercalysWorkbook(storeId, productId, flow, date, sales);
          const pub = await new MercalysImportPublicationRepository(
            device,
            randomUUID,
          ).publish(f.input);
          blobs.set(pub.sourceDocumentId, f.bytes);
          await db
            .collection<Document & { _id: string }>("sourceDocuments")
            .insertOne({
              _id: pub.sourceDocumentId,
              storeId,
              sourceType: flow,
              checksum: f.input.checksum,
              objectKey: pub.sourceDocumentId,
              remoteUploadStatus: "CONFIRMED",
            });
          await createMongoImportVerificationService(service, reader).verify(
            storeId,
            pub.sourceDocumentId,
            {
              sourceType: flow,
              checksum: f.input.checksum,
              businessPeriodStart: date,
              businessPeriodEnd: date,
              localNormalizedFingerprint: fingerprintMercalysRecords(
                f.input.summary.lines.map((l) => l.record),
              ),
              localRecordCount: f.input.summary.lines.length,
            },
          );
          return pub;
        };
        const sales = await publish("MERCALYS_SALES", "2026-10-07"),
          waste = await publish("MERCALYS_WASTE", "2025-10-01");
        const snapshot = await readMercalysPublication(
          device,
          storeId,
          sales.sourceDocumentId,
        );
        const observationId = snapshot!.sales[0]!.id;
        // Model the already-published pre-upgrade device: completed source transfer, no business Outbox.
        await device.runAsync("DELETE FROM sync_outbox");
        await device.runAsync(
          "UPDATE local_jobs SET status='COMPLETED' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        );
        device.db.close();
        device = new MercalysTestDatabase(new DatabaseSync(path));
        await repairMercalysPublications(device, storeId, randomUUID);
        const deviceId = (await device.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_metadata WHERE key='device_id'",
        ))!.value;
        const forged = structuredClone(snapshot!);
        forged.sales[0]!.salesValue = "999";
        const invalid = await push.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId,
            deviceId,
            commands: [
              {
                commandId: randomUUID(),
                localSequence: 1,
                type: "MERCALYS_PUBLISH",
                entityType: "mercalys_publication",
                entityId: sales.sourceDocumentId,
                expectedRemoteVersion: null,
                createdAt: mercalysTimestamp,
                payload: forged,
              },
            ],
          },
          randomUUID(),
          ownerId,
        );
        expect(invalid.results[0]).toMatchObject({
          status: "REJECTED",
          error: { code: "MERCALYS_OBSERVATION_INVALID" },
        });
        expect(
          await db.collection("salesObservations").countDocuments({ storeId }),
        ).toBe(0);
        expect(
          await db.collection("sourceRecords").countDocuments({ storeId }),
        ).toBe(0);
        const sync = new MobileSyncService(device, transport, {
          appVersion: "test",
          deviceId,
          mercalysPublications: true,
          sleep: async () => {},
        });
        const result = await sync.sync(storeId);
        expect(result).toMatchObject({ pushed: 2, failed: 0, conflicts: 0 });
        await repairMercalysPublications(device, storeId, randomUUID);
        expect(await sync.sync(storeId)).toMatchObject({
          pushed: 0,
          failed: 0,
        });
        expect(
          await db.collection("salesObservations").countDocuments({ storeId }),
        ).toBe(1);
        expect(
          await db
            .collection("wasteObservations")
            .countDocuments({ storeId, sourceType: "MERCALYS" }),
        ).toBe(1);
        expect(
          (await db
            .collection<Document & { _id: string }>("salesObservations")
            .findOne({ _id: observationId }))!.salesValue.toString(),
        ).toBe("12.4");
        for (const [date, metric] of [
          ["2026-10-07", "sales"],
          ["2025-10-01", "waste"],
        ] as const) {
          const analysis = await readPeriodAnalysis(db, storeId, {
            productId: null,
            currentPeriod: { start: date, end: date },
            referencePeriod: null,
            aggregation: "SUM",
            metrics: [metric],
          });
          if (metric === "waste") {
            expect(analysis.wasteDrivers?.products[0]?.productId).toBe(
              productId,
            );
            const driver = analysis.evidence.find(
              (e) => e.id === analysis.wasteDrivers?.products[0]?.evidenceId,
            );
            expect(Number(driver?.value)).toBe(12.4);
            expect(driver?.detail).toContain("pas une estimation");
            const quality = analysis.evidence.find((e) =>
              e.label.startsWith("Couverture"),
            );
            expect(quality?.detail).toContain("jours calendaires");
            expect(quality?.value).not.toContain("jours calendaires");
          }
          expect(analysis.coverage[0]!.availablePeriods).toEqual([
            { start: date, end: date },
          ]);
          const audit = await readMercalysPeriodAudit(
            db,
            storeId,
            { start: date, end: date },
            metric === "sales" ? "MERCALYS_SALES" : "MERCALYS_WASTE",
          );
          expect(audit.files).toBe(1);
          expect(audit.publishedRows).toBe(1);
          expect(
            analysis.evidence.some((e) =>
              e.label.startsWith("Publications Mercalys consultées"),
            ),
          ).toBe(true);
          expect(
            analysis.coverage[0]!.current.availableDays +
              analysis.coverage[0]!.current.partialDays,
          ).toBe(1);
          expect(
            analysis.evidence.some(
              (e) => e.value !== null && Number(e.value) === 12.4,
            ),
          ).toBe(true);
        }
        for (const request of sent.slice()) {
          const replay = await push.push(request, randomUUID(), ownerId);
          expect(
            replay.results.every((r) => r.status === "ALREADY_APPLIED"),
          ).toBe(true);
        }
        expect(
          await db.collection("salesObservations").countDocuments({ storeId }),
        ).toBe(1);
        const oldClient = await pull.pull(
          storeId,
          syncPullQuerySchema.parse({}),
        );
        expect(
          oldClient.changes.some(
            (c) => c.entityType === "mercalys_publication",
          ),
        ).toBe(false);
        const stale = structuredClone(snapshot!);
        stale.sales[0]!.deletedAt = mercalysTimestamp;
        stale.sales[0]!.updatedAt = mercalysTimestamp;
        stale.sales[0]!.version = 2;
        const staleResult = await push.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId,
            deviceId,
            commands: [
              {
                commandId: randomUUID(),
                localSequence: 1,
                type: "MERCALYS_PUBLISH",
                entityType: "mercalys_publication",
                entityId: sales.sourceDocumentId,
                expectedRemoteVersion: null,
                createdAt: mercalysTimestamp,
                payload: stale,
              },
            ],
          },
          randomUUID(),
          ownerId,
        );
        expect(staleResult.results[0]).toMatchObject({
          status: "CONFLICT",
          remoteVersion: 1,
        });
        expect(
          await db
            .collection("salesObservations")
            .countDocuments({ storeId, deletedAt: null }),
        ).toBe(1);
        const absent = await readPeriodAnalysis(db, storeId, {
          productId: null,
          currentPeriod: { start: "2025-10-02", end: "2025-10-02" },
          referencePeriod: null,
          aggregation: "SUM",
          metrics: ["waste"],
        });
        expect(absent.coverage[0]!.current.missingDays).toBe(1);
        await mercalysLocalFixture(other, storeId, productId);
        const otherId = (await other.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_metadata WHERE key='device_id'",
        ))!.value;
        await new MobileSyncService(other, transport, {
          appVersion: "test",
          deviceId: otherId,
          mercalysPublications: true,
        }).sync(storeId);
        expect(
          await other.getFirstAsync(
            "SELECT id,sync_state FROM sales_observations",
          ),
        ).toEqual({ id: observationId, sync_state: "SYNCED" });
        expect(
          await other.getFirstAsync(
            "SELECT business_date FROM waste_observations",
          ),
        ).toEqual({ business_date: "2025-10-01" });
        const recomputer = new SQLiteProductDateRecomputer(other);
        await recomputer.recomputeProduct(storeId, {
          productId,
          businessDate: "2026-10-07",
        });
        const localPerformance = await other.getFirstAsync<{
          payload_json: string;
        }>(
          "SELECT payload_json FROM product_daily_performance WHERE product_id=?",
          productId,
        );
        expect(
          Number(JSON.parse(localPerformance!.payload_json).sales.salesValue),
        ).toBe(12.4);

        // Corrected source replaces the old observation with a tombstone before adding the new row.
        const f = mercalysWorkbook(
          storeId,
          productId,
          "MERCALYS_SALES",
          "2026-10-07",
          20,
          false,
        );
        const repository = new MercalysImportPublicationRepository(
          device,
          randomUUID,
        );
        const reconciliation = (await repository.analyzeOverlap(
          storeId,
          f.input.summary,
        ))!;
        const corrected = await repository.publish({
          ...f.input,
          reconciliationApproval: {
            fingerprint: reconciliation.fingerprint,
            actorUserId: ownerId,
          },
        });
        blobs.set(corrected.sourceDocumentId, f.bytes);
        await db
          .collection<Document & { _id: string }>("sourceDocuments")
          .insertOne({
            _id: corrected.sourceDocumentId,
            storeId,
            sourceType: "MERCALYS_SALES",
            checksum: f.input.checksum,
            objectKey: corrected.sourceDocumentId,
            remoteUploadStatus: "CONFIRMED",
            verificationStatus: "MATCH",
          });
        // A replacement can reach the server before the prior source tombstone (e.g. an in-flight initial publication).
        await device.runAsync(
          "UPDATE sync_outbox SET local_sequence=(SELECT MAX(local_sequence)+1 FROM sync_outbox) WHERE entity_type='mercalys_publication' AND entity_id=? AND status='PENDING'",
          sales.sourceDocumentId,
        );
        expect(await sync.sync(storeId)).toMatchObject({
          pushed: 2,
          failed: 0,
          conflicts: 0,
        });
        expect(
          await db
            .collection("salesObservations")
            .countDocuments({ storeId, deletedAt: null }),
        ).toBe(1);
        expect(
          await readMercalysPeriodAudit(
            db,
            storeId,
            { start: "2026-10-07", end: "2026-10-07" },
            "MERCALYS_SALES",
          ),
        ).toEqual({ files: 1, publishedRows: 1, reviewRows: 0 });
        expect(
          await readMercalysPeriodAudit(
            db,
            randomUUID(),
            { start: "2026-10-07", end: "2026-10-07" },
            "MERCALYS_SALES",
          ),
        ).toEqual({ files: 0, publishedRows: 0, reviewRows: 0 });
        const correctedAnalysis = await readPeriodAnalysis(db, storeId, {
          productId: null,
          currentPeriod: { start: "2026-10-07", end: "2026-10-07" },
          referencePeriod: null,
          aggregation: "SUM",
          metrics: ["sales"],
        });
        expect(
          correctedAnalysis.evidence.some(
            (e) => e.value !== null && Number(e.value) === 20,
          ),
        ).toBe(true);
        expect(
          (await readMercalysPublication(
            device,
            storeId,
            waste.sourceDocumentId,
          ))!.waste,
        ).toHaveLength(1);
      } finally {
        device.db.close();
        other.db.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);
