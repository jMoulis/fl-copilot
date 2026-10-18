import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  partialChatImportFixture,
  automaticPartialChatImportFixture,
} from "../../../scripts/test-chat-import-fixtures";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
} from "../../../scripts/test-mercalys-sync-fixtures";
import {
  RemoteAnalyticsConfirmationService,
  createMongoRemoteAnalyticsRepository,
} from "../src/analytics/remote-confirmation";
import { runMongoMigrations } from "../src/database/migrations";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { createMongoImportVerificationService } from "../src/imports/import-verification-service";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { readMercalysPublication } from "../../mobile/src/documents/mercalys-publication-sync";
import { fingerprintMercalysRecords } from "@fl-copilot/import-core";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
} from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "complete a partial Mercalys source → real synchronization → incremental second device",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_partial_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
    it.each([
      { flow: "MERCALYS_SALES", beforeFirstAck: false, automatic: false },
      { flow: "MERCALYS_WASTE", beforeFirstAck: false, automatic: false },
      { flow: "MERCALYS_SALES", beforeFirstAck: true, automatic: false },
      { flow: "MERCALYS_WASTE", beforeFirstAck: true, automatic: false },
      { flow: "MERCALYS_SALES", beforeFirstAck: false, automatic: true },
      { flow: "MERCALYS_WASTE", beforeFirstAck: true, automatic: true },
    ] as const)(
      "keeps IDs and all previously published facts ($flow, complete before first ack: $beforeFirstAck, automatic initial subset: $automatic)",
      async ({ flow, beforeFirstAck, automatic }) => {
        const s = await (automatic
            ? automaticPartialChatImportFixture(flow)
            : partialChatImportFixture(flow)),
          other = new MercalysTestDatabase();
        try {
          const sourceId = s.publication.sourceDocumentId,
            repo = new ProductMasterRepository(s.a),
            base = (await repo.getProduct(s.productId))!.entity;
          await db
            .collection<Document & { _id: string }>("products")
            .insertOne({
              _id: base.id,
              ...base,
              createdAt: new Date(base.createdAt),
              updatedAt: new Date(base.updatedAt),
            });
          for (const row of await repo.listIdentifiers(s.productId))
            await db
              .collection<Document & { _id: string }>("productIdentifiers")
              .insertOne({
                _id: row.entity.id,
                ...row.entity,
                createdAt: new Date(row.entity.createdAt),
                updatedAt: new Date(row.entity.updatedAt),
              });
          const service = {
            getDb: async () => db,
            checkHealth: async () => "connected" as const,
            close: async () => {},
          };
          const blobs = new Map([[sourceId, s.file.f.bytes]]);
          const reader = {
            read: async (key: string) => blobs.get(key) ?? null,
          };
          await db
            .collection<Document & { _id: string }>("sourceDocuments")
            .insertOne({
              _id: sourceId,
              storeId: s.scope.storeId,
              sourceType: flow,
              checksum: s.file.f.input.checksum,
              objectKey: sourceId,
              remoteUploadStatus: "CONFIRMED",
            });
          await createMongoImportVerificationService(service, reader).verify(
            s.scope.storeId,
            sourceId,
            {
              sourceType: flow,
              checksum: s.file.f.input.checksum,
              businessPeriodStart: s.summary.businessPeriodStart,
              businessPeriodEnd: s.summary.businessPeriodEnd,
              localNormalizedFingerprint: fingerprintMercalysRecords(
                s.summary.lines.map((l) => l.record),
              ),
              localRecordCount: s.summary.lines.length,
            },
          );
          const push = createMongoSyncPushService(
              service,
              () => new Date(),
              reader,
            ),
            pull = createMongoSyncPullService(service),
            bootstrap = createMongoSyncBootstrapService(service);
          const scope = {
            storeId: s.scope.storeId,
            userId: s.scope.ownerId,
            sessionId: randomUUID(),
            deviceId: s.scope.deviceId,
            storeName: "Pilote",
            role: "MANAGER" as const,
          };
          const transport = {
            push: (request: Parameters<typeof push.push>[0]) =>
              push.push(request, randomUUID(), s.scope.ownerId),
            pull: (id: string, cursor?: string) =>
              pull.pull(
                id,
                syncPullQuerySchema.parse({
                  cursor,
                  mercalysPublications: "true",
                  mercalysRecordUpdates: "true",
                }),
              ),
            bootstrap: () =>
              bootstrap.bootstrap(
                scope,
                bootstrapQuerySchema.parse({
                  mercalysPublications: "true",
                  mercalysRecordUpdates: "true",
                }),
              ),
          };
          const sync = new MobileSyncService(s.a, transport, {
            appVersion: "test",
            deviceId: s.scope.deviceId,
            mercalysPublications: true,
            mercalysRecordUpdates: true,
            sleep: async () => {},
          });
          await mercalysLocalFixture(other, s.scope.storeId, s.productId);
          const legacyTransport = {
            ...transport,
            pull: (id: string, cursor?: string) =>
              pull.pull(
                id,
                syncPullQuerySchema.parse({
                  cursor,
                  mercalysPublications: "true",
                }),
              ),
          };
          const otherSync = new MobileSyncService(other, legacyTransport, {
            appVersion: "test",
            deviceId: randomUUID(),
            mercalysPublications: true,
            sleep: async () => {},
          });
          if (!beforeFirstAck) {
            expect(await sync.sync(s.scope.storeId)).toMatchObject({
              pushed: 1,
              conflicts: 0,
              failed: 0,
            });
            const initialMetrics = await new RemoteAnalyticsConfirmationService(
              createMongoRemoteAnalyticsRepository(service),
            ).confirm(s.scope.storeId, [
              { productId: s.productId, businessDate: "2026-10-07" },
            ]);
            const metric =
              flow === "MERCALYS_SALES" ? "salesValue" : "wasteSalesValue";
            expect(
              initialMetrics.departments[0]!.availability[metric].status,
            ).toBe("PARTIAL");
            await otherSync.sync(s.scope.storeId);
            expect(
              (await readMercalysPublication(other, s.scope.storeId, sourceId))!
                .records[1]!.status,
            ).toBe("WARNING");
          }
          const review = (await s.controller.run(s.file.message)).items[0]!;
          if (review.status !== "REVIEW")
            throw Error("Expected remaining rows");
          await s.controller.resolve(s.file.message, review, {
            resolutionKey: review.resolutions[0]!.key,
            productId: s.productId,
          });
          expect(
            (await s.controller.run(s.file.message)).items[0],
          ).toMatchObject({
            status: "PUBLISHED",
            completedPartial: true,
            sourceDocumentId: sourceId,
          });
          expect(await sync.sync(s.scope.storeId)).toMatchObject({
            pushed: beforeFirstAck ? 3 : 2,
            conflicts: 0,
            failed: 0,
          });
          expect(await sync.sync(s.scope.storeId)).toMatchObject({
            pushed: 0,
            conflicts: 0,
            failed: 0,
          });
          const finalMetrics = await new RemoteAnalyticsConfirmationService(
            createMongoRemoteAnalyticsRepository(service),
          ).confirm(s.scope.storeId, [
            { productId: s.productId, businessDate: "2026-10-07" },
          ]);
          expect(
            finalMetrics.departments[0]!.availability[
              flow === "MERCALYS_SALES" ? "salesValue" : "wasteSalesValue"
            ].status,
          ).toBe("AVAILABLE");
          expect(
            flow === "MERCALYS_SALES"
              ? finalMetrics.departments[0]!.sales.salesValue
              : finalMetrics.departments[0]!.waste.salesValue,
          ).toBe("17.40");
          let additionalSourceId: string | undefined;
          if (flow === "MERCALYS_SALES" && !beforeFirstAck) {
            // A legacy reader must not consume later v1 publications while missing
            // row-revised predecessors (including replacements in the real flow).
            const extra = await s.add({ review: false, date: "2026-10-08" });
            const published = (await s.controller.run(extra.message)).items[0]!;
            if (published.status !== "PUBLISHED")
              throw Error("Expected independent source");
            additionalSourceId = published.sourceDocumentId;
            const p = (await readMercalysPublication(
              s.a,
              s.scope.storeId,
              additionalSourceId,
            ))!;
            expect(p.records.every((r) => r.version === 1)).toBe(true);
            blobs.set(additionalSourceId, extra.f.bytes);
            await db
              .collection<Document & { _id: string }>("sourceDocuments")
              .insertOne({
                _id: additionalSourceId,
                storeId: s.scope.storeId,
                sourceType: flow,
                checksum: extra.f.input.checksum,
                objectKey: additionalSourceId,
                remoteUploadStatus: "CONFIRMED",
              });
            await createMongoImportVerificationService(service, reader).verify(
              s.scope.storeId,
              additionalSourceId,
              {
                sourceType: flow,
                checksum: extra.f.input.checksum,
                businessPeriodStart: p.source.businessPeriodStart,
                businessPeriodEnd: p.source.businessPeriodEnd,
                localNormalizedFingerprint: fingerprintMercalysRecords(
                  extra.f.input.summary.lines.map((l) => l.record),
                ),
                localRecordCount: p.records.length,
              },
            );
            expect(await sync.sync(s.scope.storeId)).toMatchObject({
              pushed: 1,
              conflicts: 0,
              failed: 0,
            });
          }
          await otherSync.sync(s.scope.storeId);
          if (additionalSourceId)
            expect(
              await readMercalysPublication(
                other,
                s.scope.storeId,
                additionalSourceId,
              ),
            ).toBeNull();
          const legacy = await readMercalysPublication(
            other,
            s.scope.storeId,
            sourceId,
          );
          if (beforeFirstAck) expect(legacy).toBeNull();
          else expect(legacy!.records[1]!.status).toBe("WARNING");
          expect(
            await other.getFirstAsync(
              "SELECT value FROM app_metadata WHERE key=?",
              `mercalys-record-updates:${s.scope.storeId}`,
            ),
          ).toBeNull();
          const upgraded = new MobileSyncService(other, transport, {
            appVersion: "test",
            deviceId: randomUUID(),
            mercalysPublications: true,
            mercalysRecordUpdates: true,
            sleep: async () => {},
          });
          await upgraded.sync(s.scope.storeId);
          if (additionalSourceId)
            expect(
              (await readMercalysPublication(
                other,
                s.scope.storeId,
                additionalSourceId,
              ))!.records[0]!.status,
            ).toBe("PUBLISHED");
          expect(
            await other.getFirstAsync(
              "SELECT value FROM app_metadata WHERE key=?",
              `mercalys-record-updates:${s.scope.storeId}`,
            ),
          ).toEqual({ value: "1" });
          const snapshot = (await readMercalysPublication(
            other,
            s.scope.storeId,
            sourceId,
          ))!;
          expect(
            snapshot.records.map((r) => [r.id, r.status, r.version]),
          ).toEqual(
            s.initial.records.map((r, n) => [
              r.id,
              "PUBLISHED",
              n === 0 ? 1 : 2,
            ]),
          );
          expect([...snapshot.sales, ...snapshot.waste]).toHaveLength(2);
          const first = [...s.initial.sales, ...s.initial.waste][0]!;
          expect(
            [...snapshot.sales, ...snapshot.waste].find(
              (o) => o.id === first.id,
            ),
          ).toEqual(first);
          expect(
            await db
              .collection("mercalysPublications")
              .countDocuments({ storeId: s.scope.storeId }),
          ).toBe(additionalSourceId ? 2 : 1);
          const remote = await db
            .collection("mercalysPublications")
            .findOne({ storeId: s.scope.storeId, id: sourceId });
          expect(remote?.remoteVersion).toBe(2);
          expect(
            await db
              .collection(
                flow === "MERCALYS_SALES"
                  ? "salesObservations"
                  : "wasteObservations",
              )
              .countDocuments({ storeId: s.scope.storeId, deletedAt: null }),
          ).toBe(additionalSourceId ? 3 : 2);
          expect(
            (await s.controller.run(s.file.message)).items[0],
          ).toMatchObject({ status: "PUBLISHED", alreadyPublished: true });
        } finally {
          s.db.close();
          other.db.close();
        }
      },
    );
    it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
      "scopes source incompleteness and ignores a superseded partial aggregate (%s)",
      async (flow) => {
        const s = await automaticPartialChatImportFixture(flow);
        try {
          const sourceId = s.publication.sourceDocumentId;
          await db
            .collection<Document & { _id: string }>("mercalysPublications")
            .insertOne({
              _id: sourceId,
              id: sourceId,
              storeId: s.scope.storeId,
              version: 1,
              remoteVersion: 1,
              publication: s.initial,
            });
          const repository = createMongoRemoteAnalyticsRepository({
            getDb: async () => db,
            checkHealth: async () => "connected" as const,
            close: async () => {},
          });
          expect(
            await repository.loadDepartmentSourceCompleteness(
              s.scope.storeId,
              "2026-10-07",
            ),
          ).toEqual({
            sales: flow === "MERCALYS_SALES",
            waste: flow === "MERCALYS_WASTE",
          });
          expect(
            await repository.loadDepartmentSourceCompleteness(
              s.scope.storeId,
              "2026-10-08",
            ),
          ).toEqual({ sales: false, waste: false });
          expect(
            await repository.loadDepartmentSourceCompleteness(
              randomUUID(),
              "2026-10-07",
            ),
          ).toEqual({ sales: false, waste: false });
          const channel = flow === "MERCALYS_SALES" ? "sales" : "waste";
          await db.collection("mercalysPublications").updateOne(
            { id: sourceId, storeId: s.scope.storeId },
            {
              $set: {
                [`publication.${channel}.0.deletedAt`]:
                  new Date().toISOString(),
              },
            },
          );
          expect(
            await repository.loadDepartmentSourceCompleteness(
              s.scope.storeId,
              "2026-10-07",
            ),
          ).toEqual({ sales: false, waste: false });
          expect(
            await db.collection("mercalysPublications").countDocuments({
              id: sourceId,
              "publication.records": { $elemMatch: { status: "WARNING" } },
            }),
          ).toBe(1);
        } finally {
          s.db.close();
        }
      },
    );
  },
);
