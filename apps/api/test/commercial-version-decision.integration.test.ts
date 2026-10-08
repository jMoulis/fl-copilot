import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { commercialVersionFixture } from "../../../scripts/test-commercial-version-fixtures";
import type {
  CommercialVersionDecision,
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
  "commercial PDF reference decisions",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_version_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      await (await database.getDb()).dropDatabase();
      await database.close();
    });

    async function seed() {
      const x = await commercialVersionFixture(),
        db = await database.getDb();
      for (const reading of [x.f.reading, x.g.reading])
        await db
          .collection<{ _id: string }>("commercialVisualReadings")
          .insertOne({ ...reading, _id: reading.id });
      return { ...x, db };
    }
    function request(
      p: CommercialVersionDecision,
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
            type: "COMMERCIAL_VERSION_DECISION_UPSERT",
            entityType: "commercial_version_decision",
            entityId: p.id,
            expectedRemoteVersion: expected,
            createdAt: p.updatedAt,
            payload: p,
          },
        ],
      };
    }
    it("persists a reference decision exactly once without touching the source, choices, plans or publication", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.decision);
      expect((await push.push(r, "first")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await x.db
          .collection("commercialVersionDecisionHistory")
          .countDocuments({ storeId: x.f.storeId }),
      ).toBe(1);
      expect(
        await x.db
          .collection("commercialVisualReadings")
          .countDocuments({ storeId: x.f.storeId }),
      ).toBe(2);
      for (const name of [
        "commercialOfferChoices",
        "commercialWeekPreparations",
        "offers",
        "commercialOperations",
        "actionExecutions",
      ])
        expect(
          await x.db.collection(name).countDocuments({ storeId: x.f.storeId }),
        ).toBe(0);
    }, 20000);
    it("rejects cross-store source snapshots, partial readings and checksum tampering", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      expect(
        (
          await push.push(
            request({
              ...x.decision,
              after: { ...x.decision.after, checksum: "forged" },
            }),
            "forged",
          )
        ).results[0]?.error?.code,
      ).toBe("COMMERCIAL_VERSION_DECISION_SOURCE_INVALID");
      const r = request(x.decision);
      r.storeId = randomUUID();
      expect((await push.push(r, "tenant")).results[0]?.status).toBe(
        "REJECTED",
      );
      await x.db
        .collection<{ _id: string }>("commercialVisualReadings")
        .updateOne({ _id: x.g.reading.id }, { $set: { pageCount: 2 } });
      expect(
        (await push.push(request(x.decision), "partial")).results[0]?.error
          ?.code,
      ).toBe("COMMERCIAL_VERSION_DECISION_SOURCE_INVALID");
    }, 20000);
    it("preserves simultaneous decisions as a conflict and permits explicit revision only", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(x.decision), "a");
      expect(
        (
          await push.push(
            request({ ...x.decision, preference: "PREFER_NEW" }),
            "b",
          )
        ).results[0],
      ).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { preference: "KEEP_PREVIOUS" },
      });
      expect(
        (
          await push.push(
            request({ ...x.decision, preference: "PREFER_NEW", version: 2 }, 1),
            "rebase",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request(
              {
                ...x.decision,
                before: x.decision.after,
                after: x.decision.before,
                version: 3,
              },
              2,
            ),
            "inverted",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
    }, 20000);
    it("skips the new entity for old apps while restoring it on capable bootstrap/pull", async () => {
      const x = await seed();
      await createMongoSyncPushService(database).push(
        request(x.decision),
        "saved",
      );
      const pull = createMongoSyncPullService(database);
      const old = await pull.pull(x.f.storeId, { limit: 500 });
      expect(old.changes).toEqual([]);
      expect(old.nextCursor).toBeTruthy();
      expect(
        (
          await pull.pull(x.f.storeId, {
            limit: 500,
            commercialVersions: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ preference: "KEEP_PREVIOUS" });
      const store = {
        storeId: x.f.storeId,
        storeName: "Test",
        role: "MANAGER",
        userId: randomUUID(),
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
      const boot = createMongoSyncBootstrapService(database);
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .commercialVersionDecisions,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            commercialVersions: "true",
          })
        ).entities.commercialVersionDecisions,
      ).toHaveLength(1);
    }, 20000);
  },
);
