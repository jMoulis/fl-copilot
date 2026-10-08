import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import type {
  CommercialOfferChoice,
  SyncPushRequest,
} from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "commercial store offer choices",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_choice_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      await (await database.getDb()).dropDatabase();
      await database.close();
    });
    async function seed() {
      const f = await commercialChoiceFixture(),
        db = await database.getDb();
      await db
        .collection<{ _id: string; createdAt: Date; updatedAt: Date }>(
          "products",
        )
        .insertOne({
          ...f.product,
          _id: f.productId,
          createdAt: new Date(f.product.createdAt),
          updatedAt: new Date(f.product.updatedAt),
        });
      await db
        .collection<{ _id: string }>("commercialVisualReadings")
        .insertOne({ ...f.reading, _id: f.readingId });
      return f;
    }
    function request(
      choice: CommercialOfferChoice,
      expected: number | null = null,
      commandId = randomUUID(),
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: choice.storeId,
        commands: [
          {
            commandId,
            localSequence: 1,
            type: "COMMERCIAL_OFFER_CHOICE_UPSERT",
            entityType: "commercial_offer_choice",
            entityId: choice.id,
            expectedRemoteVersion: expected,
            createdAt: choice.updatedAt,
            payload: choice,
          },
        ],
      };
    }
    it("retains once under replay, records audit and sync, and never publishes an operation, execution or observation", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database),
        req = request(f.choice);
      expect((await push.push(req, "first")).results[0]?.status).toBe(
        "APPLIED",
      );
      expect((await push.push(req, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const db = await database.getDb();
      expect(
        await db
          .collection("commercialOfferChoices")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await db
          .collection("commercialChoiceHistory")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: f.storeId,
          entityType: "commercial_offer_choice",
        }),
      ).toBe(1);
      for (const name of [
        "offers",
        "commercialOperations",
        "actionExecutions",
        "salesObservations",
        "wasteObservations",
      ])
        expect(
          await db.collection(name).countDocuments({ storeId: f.storeId }),
        ).toBe(0);
    }, 20000);
    it("preserves different-device choices and only revises with the confirmed remote version", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      expect(
        (await push.push(request(f.choice), "device-a")).results[0]?.status,
      ).toBe("APPLIED");
      const other = {
        ...f.choice,
        status: "WITHDRAWN" as const,
        createdAt: "2026-10-08T09:00:00.000Z",
      };
      const conflict = (await push.push(request(other), "device-b"))
        .results[0]!;
      expect(conflict.status).toBe("CONFLICT");
      expect(conflict.remoteEntity).toMatchObject({
        status: "RETAINED",
        version: 1,
      });
      const withdrawal = {
        ...f.choice,
        status: "WITHDRAWN" as const,
        version: 2,
        updatedAt: "2026-10-08T09:01:00.000Z",
      };
      expect(
        (await push.push(request(withdrawal, 1), "explicit-withdrawal"))
          .results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await (
          await database.getDb()
        )
          .collection("commercialChoiceHistory")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(2);
    }, 20000);
    it("rejects another store, tampered source indices, missing critical confirmation and inactive products", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      for (const choice of [
        { ...f.choice, operationLabel: "Changed source" },
        { ...f.choice, criticalFieldsConfirmed: false },
        { ...f.choice, productId: randomUUID() },
      ])
        expect(
          (await push.push(request(choice as CommercialOfferChoice), "invalid"))
            .results[0]?.status,
        ).toBe("REJECTED");
      await (
        await database.getDb()
      )
        .collection<{ _id: string }>("products")
        .updateOne({ _id: f.productId }, { $set: { status: "INACTIVE" } });
      expect(
        (await push.push(request(f.choice), "inactive")).results[0]?.error
          ?.code,
      ).toBe("COMMERCIAL_CHOICE_PRODUCT_INVALID");
      const foreign = request(f.choice);
      foreign.storeId = randomUUID();
      expect((await push.push(foreign, "foreign")).results[0]?.status).toBe(
        "REJECTED",
      );
      expect(
        await (
          await database.getDb()
        )
          .collection("commercialOfferChoices")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 20000);
    it("restores choices for capable clients and keeps old client cursors safe", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.choice), "create");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(f.storeId, { limit: 500 })).changes).toEqual([]);
      const visible = await pull.pull(f.storeId, {
        limit: 500,
        commercialChoices: "true",
      });
      expect(visible.changes).toHaveLength(1);
      expect(visible.changes[0]?.entity).toMatchObject({
        id: f.choice.id,
        status: "RETAINED",
      });
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: f.storeId,
          storeName: "Test",
          role: "MANAGER" as const,
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .commercialOfferChoices,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            commercialChoices: "true",
          })
        ).entities.commercialOfferChoices,
      ).toHaveLength(1);
    }, 20000);
    it("rejects exact detail/recap duplication and releases that guard after explicit withdrawal", async () => {
      const f = await seed(),
        recap = await commercialChoiceFixture({
          storeId: f.storeId,
          sourceDocumentId: f.sourceDocumentId,
          productId: f.productId,
        });
      const db = await database.getDb();
      await db
        .collection<{ _id: string }>("commercialVisualReadings")
        .insertOne({
          ...JSON.parse(
            JSON.stringify(recap.reading).replaceAll(
              '"pageNumber":1',
              '"pageNumber":2',
            ),
          ),
          pageCount: 2,
          _id: recap.readingId,
        });
      const push = createMongoSyncPushService(database);
      await push.push(request(f.choice), "detail");
      expect(
        (await push.push(request(recap.choice), "recap")).results[0]?.error
          ?.code,
      ).toBe("COMMERCIAL_CHOICE_DUPLICATE");
      await push.push(
        request({ ...f.choice, status: "WITHDRAWN", version: 2 }, 1),
        "withdraw",
      );
      expect(
        (await push.push(request(recap.choice), "retain-recap")).results[0]
          ?.status,
      ).toBe("APPLIED");
    }, 20000);
    it("keeps one active selection when equal detail/recap choices race", async () => {
      const f = await seed(),
        recap = await commercialChoiceFixture({
          storeId: f.storeId,
          sourceDocumentId: f.sourceDocumentId,
          productId: f.productId,
        }),
        db = await database.getDb();
      await db
        .collection<{ _id: string }>("commercialVisualReadings")
        .insertOne({
          ...JSON.parse(
            JSON.stringify(recap.reading).replaceAll(
              '"pageNumber":1',
              '"pageNumber":2',
            ),
          ),
          pageCount: 2,
          _id: recap.readingId,
        });
      const push = createMongoSyncPushService(database),
        requests = [request(f.choice), request(recap.choice)];
      const results = await Promise.all(
        requests.map((r, i) => push.push(r, `race-${i}`)),
      );
      expect(
        results.filter((r) => r.results[0]?.status === "APPLIED"),
      ).toHaveLength(1);
      const loser = results.findIndex(
        (r) => r.results[0]?.status !== "APPLIED",
      );
      expect(
        (await push.push(requests[loser]!, "race-retry")).results[0]?.error
          ?.code,
      ).toBe("COMMERCIAL_CHOICE_DUPLICATE");
      expect(
        await db
          .collection("commercialOfferChoices")
          .countDocuments({ storeId: f.storeId, status: "RETAINED" }),
      ).toBe(1);
    }, 20000);
  },
);
