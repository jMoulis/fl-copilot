import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { chatImportFixture } from "../../../scripts/test-chat-import-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoImportVerificationService } from "../src/imports/import-verification-service";
import { readMercalysPublication } from "../../mobile/src/documents/mercalys-publication-sync";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import { fingerprintMercalysRecords } from "@fl-copilot/import-core";
import { syncPushRequestSchema } from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "native conversational Mercalys automation → canonical Atlas commands",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_chat_ingest_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
    it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
      "synchronizes auto-created identities and all source-verified rows once (%s)",
      async (flow) => {
        const s = await chatImportFixture();
        try {
          const file = await s.add({ flow }),
            report = await s.controller.run(file.message),
            result = report.items[0]!;
          if (result.status !== "PUBLISHED")
            throw Error("Expected automatic publication");
          const repo = new ProductMasterRepository(s.a),
            base = await repo.getProduct(s.productId);
          await db
            .collection<Document & { _id: string }>("products")
            .insertOne({
              _id: s.productId,
              ...base!.entity,
              createdAt: new Date(base!.entity.createdAt),
              updatedAt: new Date(base!.entity.updatedAt),
            });
          for (const identifier of await repo.listIdentifiers(s.productId))
            await db
              .collection<Document & { _id: string }>("productIdentifiers")
              .insertOne({ _id: identifier.entity.id, ...identifier.entity });
          const sourceId = result.sourceDocumentId,
            p = await readMercalysPublication(s.a, s.scope.storeId, sourceId),
            reader = { read: async () => file.f.bytes },
            service = {
              getDb: async () => db,
              checkHealth: async () => "connected" as const,
              close: async () => {},
            };
          await db
            .collection<Document & { _id: string }>("sourceDocuments")
            .insertOne({
              _id: sourceId,
              storeId: s.scope.storeId,
              sourceType: flow,
              checksum: file.f.input.checksum,
              objectKey: sourceId,
              remoteUploadStatus: "CONFIRMED",
            });
          await createMongoImportVerificationService(service, reader).verify(
            s.scope.storeId,
            sourceId,
            {
              sourceType: flow,
              checksum: file.f.input.checksum,
              businessPeriodStart: p!.source.businessPeriodStart!,
              businessPeriodEnd: p!.source.businessPeriodEnd!,
              localNormalizedFingerprint: fingerprintMercalysRecords(
                file.f.input.summary.lines.map((l) => l.record),
              ),
              localRecordCount: p!.records.length,
            },
          );
          const outbox = (
            await new OutboxRepository(s.a).listPending(s.scope.storeId)
          ).filter((c) => !c.entityType.startsWith("copilot_"));
          const request = syncPushRequestSchema.parse({
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId: s.scope.storeId,
            deviceId: s.scope.deviceId,
            commands: outbox.map((c) => ({
              commandId: c.commandId,
              localSequence: c.localSequence,
              type: c.commandType,
              entityType: c.entityType,
              entityId: c.entityId,
              expectedRemoteVersion: c.expectedRemoteVersion,
              payload: c.payload,
              createdAt: c.createdAt,
            })),
          });
          const push = createMongoSyncPushService(
            service,
            () => new Date(),
            reader,
          );
          for (let n = 0; n < 2; n++) {
            const response = await push.push(
              request,
              randomUUID(),
              s.scope.ownerId,
            );
            expect(response.results.map((r) => r.status)).toEqual(
              request.commands.map(() =>
                n === 0 ? "APPLIED" : "ALREADY_APPLIED",
              ),
            );
          }
          expect(
            await db
              .collection("products")
              .countDocuments({ storeId: s.scope.storeId }),
          ).toBe(2);
          expect(
            await db
              .collection(
                flow === "MERCALYS_SALES"
                  ? "salesObservations"
                  : "wasteObservations",
              )
              .countDocuments({ storeId: s.scope.storeId, deletedAt: null }),
          ).toBe(2);
          expect(
            await db
              .collection(
                flow === "MERCALYS_SALES"
                  ? "wasteObservations"
                  : "salesObservations",
              )
              .countDocuments({ storeId: s.scope.storeId }),
          ).toBe(0);
          expect(
            await db
              .collection("mercalysPublications")
              .countDocuments({ storeId: s.scope.storeId }),
          ).toBe(1);
        } finally {
          s.db.close();
        }
      },
    );
  },
);
