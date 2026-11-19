import {
  reviewPurchasePriceCollisions,
  selectPurchasePrice,
} from "../../mobile/src/documents/mercalys-purchase-price-review";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
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
  applyMercalysPublication,
} from "../../mobile/src/documents/mercalys-publication-sync";
import { PurchasePriceRepository } from "../../mobile/src/products/purchase-price-repository";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoImportVerificationService } from "../src/imports/import-verification-service";
import {
  syncPullQuerySchema,
  type MercalysPublication,
} from "@fl-copilot/sync-contracts";
import { fingerprintMercalysRecords } from "@fl-copilot/import-core";
import { runMongoMigrations } from "../src/database/migrations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "Daily PA source proof and synchronization",
  () => {
    let client: MongoClient;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
    });
    afterAll(async () => {
      await client?.close();
    });
    it.each([false, true])(
      "verifies the original, rejects altered amount/unit/review status, retries once and gates legacy clients (price choice=%s)",
      async (priceChoice) => {
        const db = client.db(`fl_pa_${randomUUID().replaceAll("-", "")}`),
          device = new MercalysTestDatabase(),
          other = new MercalysTestDatabase();
        try {
          await runMongoMigrations(db);
          const storeId = randomUUID(),
            productId = randomUUID(),
            deviceId = randomUUID(),
            ownerId = randomUUID();
          await mercalysLocalFixture(device, storeId, productId);
          await mercalysLocalFixture(other, storeId, productId);
          await db
            .collection<Document & { _id: string }>("products")
            .insertOne({
              _id: productId,
              storeId,
              salesUnit: "KG",
              status: "ACTIVE",
            });
          const file = mercalysWorkbook(
            storeId,
            productId,
            "MERCALYS_PURCHASE_PRICES",
            "2026-11-14",
            0.001,
            false,
            priceChoice ? 5.99 : undefined,
          );
          if (priceChoice) {
            file.input.summary.lines[1]!.match = structuredClone(
              file.input.summary.lines[0]!.match,
            );
            file.input.summary = selectPurchasePrice(
              reviewPurchasePriceCollisions(file.input.summary),
              file.input.summary.lines[0]!.record.sourceIndex,
              ownerId,
              mercalysTimestamp,
            );
          }
          const result = await new MercalysImportPublicationRepository(
            device,
            randomUUID,
          ).publish(file.input);
          const p = (await readMercalysPublication(
            device,
            storeId,
            result.sourceDocumentId,
          ))!;
          const service = {
            getDb: async () => db,
            checkHealth: async () => "connected" as const,
            close: async () => {},
          };
          const reader = { read: async () => file.bytes };
          await db
            .collection<Document & { _id: string }>("sourceDocuments")
            .insertOne({
              _id: p.source.id,
              storeId,
              sourceType: p.source.sourceType,
              checksum: p.source.checksum,
              objectKey: p.source.id,
              remoteUploadStatus: "CONFIRMED",
            });
          const verified = await createMongoImportVerificationService(
            service,
            reader,
          ).verify(storeId, p.source.id, {
            sourceType: p.source.sourceType,
            checksum: p.source.checksum,
            businessPeriodStart: p.source.businessPeriodStart,
            businessPeriodEnd: p.source.businessPeriodEnd,
            localNormalizedFingerprint: fingerprintMercalysRecords(
              file.input.summary.lines.map((l) => l.record),
            ),
            localRecordCount: p.records.length,
          });
          expect(verified.status).toBe("MATCH");
          const push = createMongoSyncPushService(
            service,
            () => new Date(mercalysTimestamp),
            reader,
          );
          const request = (
            payload: MercalysPublication,
            version: number | null = null,
          ) => ({
            syncProtocolVersion: 1 as const,
            appVersion: "test",
            storeId,
            deviceId,
            commands: [
              {
                commandId: randomUUID(),
                localSequence: 1,
                type: "MERCALYS_PUBLISH" as const,
                entityType: "mercalys_publication" as const,
                entityId: p.source.id,
                expectedRemoteVersion: version,
                createdAt: mercalysTimestamp,
                payload,
              },
            ],
          });
          for (const mutate of [
            (x: MercalysPublication) => {
              x.prices[0]!.amount = "99";
            },
            (x: MercalysPublication) => {
              x.prices[0]!.unit = "PIECE";
            },
            (x: MercalysPublication) => {
              x.prices[0]!.priceStatus = "KNOWN";
            },
          ]) {
            const forged = structuredClone(p);
            mutate(forged);
            expect(
              (await push.push(request(forged), randomUUID(), ownerId))
                .results[0]!.status,
            ).toBe("REJECTED");
          }
          const original = request(p);
          const first = await push.push(original, randomUUID(), ownerId);
          expect(first.results[0]!.status, JSON.stringify(first)).toBe(
            "APPLIED",
          );
          expect(
            (await push.push(original, randomUUID(), ownerId)).results[0]!
              .status,
          ).toBe("ALREADY_APPLIED");
          expect(
            await db
              .collection("purchasePriceObservations")
              .countDocuments({ storeId }),
          ).toBe(1);
          if (priceChoice) {
            expect(
              await db
                .collection("sourceRecords")
                .countDocuments({ storeId, status: "IGNORED" }),
            ).toBe(1);
            expect(
              p.records.find((r) => r.status === "IGNORED")?.normalizedPayload,
            ).toMatchObject({
              purchasePrice: { amount: "5.99" },
              purchasePriceSelection: { actorUserId: ownerId },
            });
          }
          const pull = createMongoSyncPullService(service);
          const legacy = await pull.pull(
            storeId,
            syncPullQuerySchema.parse({
              mercalysPublications: "true",
              mercalysRecordUpdates: "true",
            }),
          );
          expect(legacy.changes).toHaveLength(0);
          const page = await pull.pull(
            storeId,
            syncPullQuerySchema.parse({
              mercalysPublications: "true",
              mercalysRecordUpdates: "true",
              purchasePrices: "true",
            }),
          );
          expect(page.changes).toHaveLength(1);
          await applyMercalysPublication(
            other,
            storeId,
            page.changes[0]!.entity,
          );
          expect(
            (
              await new PurchasePriceRepository(other).history(
                storeId,
                productId,
                "2026-11-18",
              )
            )[0],
          ).toMatchObject({
            amount: "0.001",
            price_status: "TO_VERIFY",
            sync_state: "SYNCED",
          });
          await new PurchasePriceRepository(device).confirm(
            storeId,
            productId,
            p.prices[0]!.id,
            1,
            {
              now: mercalysTimestamp,
              generateId: randomUUID,
              assertCurrentScope: () => {},
            },
          );
          const confirmed = (await readMercalysPublication(
            device,
            storeId,
            p.source.id,
          ))!;
          expect(
            (await push.push(request(confirmed, 1), randomUUID(), ownerId))
              .results[0]!.status,
          ).toBe("APPLIED");
          const confirmedPage = await pull.pull(
            storeId,
            syncPullQuerySchema.parse({
              mercalysPublications: "true",
              mercalysRecordUpdates: "true",
              purchasePrices: "true",
            }),
          );
          for (const change of confirmedPage.changes)
            await applyMercalysPublication(other, storeId, change.entity);
          expect(
            (
              await new PurchasePriceRepository(other).history(
                storeId,
                productId,
                "2026-11-18",
              )
            )[0],
          ).toMatchObject({ price_status: "KNOWN", version: 2 });
          const changedUnit = structuredClone(confirmed);
          changedUnit.prices[0]!.unit = "PIECE";
          changedUnit.prices[0]!.version++;
          expect(
            (await push.push(request(changedUnit, 2), randomUUID(), ownerId))
              .results[0]!.status,
          ).toBe("REJECTED");
          expect(
            await db
              .collection("salesObservations")
              .countDocuments({ storeId }),
          ).toBe(0);
          expect(
            await db
              .collection("wasteObservations")
              .countDocuments({ storeId }),
          ).toBe(0);
        } finally {
          device.db.close();
          other.db.close();
          await db.dropDatabase();
        }
      },
      30000,
    );
  },
);
