import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../scripts/test-commercial-choice-fixtures";
import { commercialWeekPreparationId } from "@fl-copilot/commercial-core";
import type {
  CommercialWeekPreparation,
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
  "weekly TG preparation",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_prep_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
        .collection<{ _id: string }>("commercialOfferChoices")
        .insertOne({ ...f.choice, _id: f.choice.id });
      const plan: CommercialWeekPreparation = {
        id: await commercialWeekPreparationId(
          f.storeId,
          "2026-10-05",
          testChoiceDigest,
        ),
        storeId: f.storeId,
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        status: "DRAFT",
        tgCapacity: 1,
        offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
        placements: [
          {
            id: randomUUID(),
            label: "TG entrée",
            theme: "Raisin",
            offerIds: [f.choice.id],
            sourceIdea: null,
          },
        ],
        note: "",
        version: 1,
        createdAt: f.choice.createdAt,
        updatedAt: f.choice.updatedAt,
      };
      return { f, plan, db };
    }
    function request(
      p: CommercialWeekPreparation,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: p.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COMMERCIAL_WEEK_PREPARATION_UPSERT",
            entityType: "commercial_week_preparation",
            entityId: p.id,
            expectedRemoteVersion: expected,
            createdAt: p.updatedAt,
            payload: p,
          },
        ],
      };
    }
    it("persists a draft once with audit/sync and never records execution or canonical publication", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.plan);
      expect((await push.push(r, "first")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await x.db
          .collection("commercialPreparationHistory")
          .countDocuments({ storeId: x.f.storeId }),
      ).toBe(1);
      for (const name of ["offers", "commercialOperations", "actionExecutions"])
        expect(
          await x.db.collection(name).countDocuments({ storeId: x.f.storeId }),
        ).toBe(0);
    }, 20000);
    it("waits for an unsynchronized offer revision and retries the same draft command once dependencies arrive", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        p = {
          ...x.plan,
          offerRefs: [{ choiceId: x.f.choice.id, choiceVersion: 2 }],
        },
        r = request(p);
      expect((await push.push(r, "pending")).results[0]?.status).toBe(
        "RETRYABLE_ERROR",
      );
      await x.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .updateOne({ _id: x.f.choice.id }, { $set: { version: 2 } });
      expect((await push.push(r, "arrived")).results[0]?.status).toBe(
        "APPLIED",
      );
    }, 20000);
    it("rejects withdrawn/stale offers, unavailable capacity and forged final validation", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      expect(
        (await push.push(request({ ...x.plan, tgCapacity: 0 }), "capacity"))
          .results[0]?.status,
      ).toBe("REJECTED");
      const invalid = request(x.plan);
      invalid.commands[0]!.payload = { ...x.plan, status: "VALIDATED" };
      expect(
        (await push.push(invalid, "invalid-state")).results[0]?.status,
      ).toBe("REJECTED");
      await x.db
        .collection<{ _id: string }>("commercialOfferChoices")
        .updateOne({ _id: x.f.choice.id }, { $set: { status: "WITHDRAWN" } });
      expect(
        (await push.push(request(x.plan), "withdrawn")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_PREPARATION_OFFERS_CHANGED");
    }, 20000);
    it("protects store boundaries and unknown source TG references", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const r = request(x.plan);
      r.storeId = randomUUID();
      expect((await push.push(r, "foreign")).results[0]?.status).toBe(
        "REJECTED",
      );
      const p = {
        ...x.plan,
        placements: x.plan.placements.map((p) => ({
          ...p,
          sourceIdea: {
            readingId: randomUUID(),
            checksum: "sha256:fake",
            tgIndex: 0,
          },
        })),
      };
      expect(
        (await push.push(request(p), "source")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_PREPARATION_SOURCE_INVALID");
    }, 20000);
    it("requires comparison of simultaneous plans and allows a subsequent explicit revision", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(x.plan), "a");
      expect(
        (await push.push(request({ ...x.plan, note: "other device" }), "b"))
          .results[0]?.status,
      ).toBe("CONFLICT");
      expect(
        (
          await push.push(
            request({ ...x.plan, note: "explicit", version: 2 }, 1),
            "resolved",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
    }, 20000);
    it("restores drafts for capable clients and safely excludes them for older installed builds", async () => {
      const x = await seed();
      await createMongoSyncPushService(database).push(request(x.plan), "saved");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(x.f.storeId, { limit: 500 })).changes).toEqual(
        [],
      );
      expect(
        (
          await pull.pull(x.f.storeId, {
            limit: 500,
            commercialPreparation: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ status: "DRAFT", tgCapacity: 1 });
      const boot = await createMongoSyncBootstrapService(database).bootstrap(
        {
          storeId: x.f.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
        { rawObservationDays: 90, commercialPreparation: "true" },
      );
      expect(boot.entities.commercialWeekPreparations).toHaveLength(1);
    }, 20000);
  },
);
