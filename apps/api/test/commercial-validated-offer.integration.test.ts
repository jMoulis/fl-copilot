import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../scripts/test-commercial-choice-fixtures";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
} from "@fl-copilot/commercial-core";
import type {
  CommercialValidatedOffer,
  SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "selected commercial offer validation",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_v_offer_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
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
      await db
        .collection<{ _id: string }>("commercialOfferChoices")
        .insertOne({ ...f.choice, _id: f.choice.id });
      const v: CommercialValidatedOffer = {
        id: await commercialValidatedOfferId(
          f.storeId,
          f.choice.id,
          1,
          testChoiceDigest,
        ),
        storeId: f.storeId,
        choice: f.choice,
        ...commercialOfferValidationSource(f.choice, [f.reading]),
        status: "VALIDATED",
        sourceReviewed: true,
        version: 1,
        createdAt: f.choice.createdAt,
      };
      return { ...f, db, v };
    }
    function request(v: CommercialValidatedOffer): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: v.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COMMERCIAL_OFFER_VALIDATE",
            entityType: "commercial_validated_offer",
            entityId: v.id,
            expectedRemoteVersion: null,
            createdAt: v.createdAt,
            payload: v,
          },
        ],
      };
    }
    it("validates an immutable choice revision exactly once under replay and equivalent decisions from two devices", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.v);
      expect((await push.push(r, "first")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        (
          await push.push(
            request({ ...x.v, createdAt: new Date().toISOString() }),
            "other-device",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await x.db
          .collection("commercialValidatedOffers")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(1);
      expect(
        await x.db.collection("syncChanges").countDocuments({
          storeId: x.storeId,
          entityType: "commercial_validated_offer",
        }),
      ).toBe(1);
      for (const t of [
        "commercialWeekPreparations",
        "actionExecutions",
        "salesObservations",
        "wasteObservations",
      ])
        expect(
          await x.db.collection(t).countDocuments({ storeId: x.storeId }),
        ).toBe(0);
    }, 20000);
    it("waits for an earlier choice dependency then retries the same command, while refusing stale or withdrawn choices", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await x.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .deleteOne({ _id: x.choice.id });
      const r = request(x.v);
      expect((await push.push(r, "pending")).results[0]?.status).toBe(
        "RETRYABLE_ERROR",
      );
      await x.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .insertOne({ ...x.choice, _id: x.choice.id });
      expect((await push.push(r, "arrived")).results[0]?.status).toBe(
        "APPLIED",
      );
      const y = await seed();
      await y.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .updateOne(
          { _id: y.choice.id },
          { $set: { status: "WITHDRAWN", version: 2 } },
        );
      expect(
        (await push.push(request(y.v), "withdrawn")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_VALIDATION_CHOICE_CHANGED");
    }, 20000);
    it("rejects forged source conditions, wrong stores, unavailable products and fabricated execution status", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      expect(
        (await push.push(request({ ...x.v, sourceFields: [] }), "tamper"))
          .results[0]?.error?.code,
      ).toBe("COMMERCIAL_VALIDATION_SOURCE_INVALID");
      const r = request(x.v);
      r.storeId = randomUUID();
      expect((await push.push(r, "tenant")).results[0]?.status).toBe(
        "REJECTED",
      );
      const invalid = request(x.v);
      invalid.commands[0]!.payload = { ...x.v, status: "EXECUTED" };
      expect((await push.push(invalid, "execute")).results[0]?.status).toBe(
        "REJECTED",
      );
      await x.db
        .collection<{ _id: string }>("products")
        .updateOne({ _id: x.productId }, { $set: { status: "ARCHIVED" } });
      expect(
        (await push.push(request(x.v), "archived")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_VALIDATION_PRODUCT_INVALID");
    }, 20000);
    it("preserves historical snapshots on old retry after a later withdrawal without reactivating the choice", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(x.v), "saved");
      await x.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .updateOne(
          { _id: x.choice.id },
          { $set: { status: "WITHDRAWN", version: 2 } },
        );
      expect(
        (await push.push(request(x.v), "old-retry")).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await x.db
          .collection("commercialOfferChoices")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ status: "WITHDRAWN", version: 2 });
      expect(
        await x.db
          .collection("commercialValidatedOffers")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(1);
    }, 20000);
    it("restores validations on capable bootstrap/pull while safely skipping them for older builds", async () => {
      const x = await seed();
      await createMongoSyncPushService(database).push(request(x.v), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(x.storeId, { limit: 500 })).changes).toEqual([]);
      expect(
        (
          await pull.pull(x.storeId, {
            limit: 500,
            commercialValidation: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({
        status: "VALIDATED",
        choice: { id: x.choice.id, version: 1 },
      });
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: x.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .commercialValidatedOffers,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            commercialValidation: "true",
          })
        ).entities.commercialValidatedOffers,
      ).toHaveLength(1);
    }, 20000);
    it("concurrent equivalent validations converge to one immutable offer and one sync change", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        requests = [
          request(x.v),
          request({ ...x.v, createdAt: new Date().toISOString() }),
        ];
      const results = await Promise.all(
        requests.map((r, i) => push.push(r, `concurrent-${i}`)),
      );
      for (const [i, result] of results.entries()) {
        if (result.results[0]?.status === "RETRYABLE_ERROR")
          expect(
            (await push.push(requests[i]!, "explicit-retry")).results[0]
              ?.status,
          ).toBe("APPLIED");
        else expect(result.results[0]?.status).toBe("APPLIED");
      }
      expect(
        await x.db
          .collection("commercialValidatedOffers")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(1);
      expect(
        await x.db.collection("syncChanges").countDocuments({
          storeId: x.storeId,
          entityType: "commercial_validated_offer",
        }),
      ).toBe(1);
    }, 20000);
  },
);
