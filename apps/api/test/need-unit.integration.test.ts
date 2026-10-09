import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { needUnitFixture } from "../../../scripts/test-need-unit-fixtures";
import type { NeedUnit, SyncPushRequest } from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "store context settings",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_store_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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

    function request(
      s: NeedUnit,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: s.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "NEED_UNIT_UPSERT",
            entityType: "need_unit",
            entityId: s.id,
            expectedRemoteVersion: expected,
            createdAt: s.updatedAt,
            payload: s,
          },
        ],
      };
    }
    it("persists one store configuration with idempotent audit and no business mutation", async () => {
      const s = needUnitFixture(),
        push = createMongoSyncPushService(database),
        r = request(s);
      expect((await push.push(r, "save")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const db = await database.getDb();
      expect(
        await db
          .collection("needUnitHistory")
          .countDocuments({ storeId: s.storeId }),
      ).toBe(1);
      for (const t of ["commercialWeekPlans", "products", "salesObservations"])
        expect(
          await db.collection(t).countDocuments({ storeId: s.storeId }),
        ).toBe(0);
    }, 20000);
    it("rejects invalid codes/ownership, compares two-device conflicts and accepts explicit revision", async () => {
      const s = needUnitFixture(),
        push = createMongoSyncPushService(database),
        r = request(s);
      r.storeId = randomUUID();
      expect((await push.push(r, "foreign")).results[0]?.status).toBe(
        "REJECTED",
      );
      expect(
        (await push.push(request({ ...s, code: "invalid code" }), "no-point"))
          .results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(s), "a");
      expect(
        (await push.push(request({ ...s, name: "Other" }), "b")).results[0]
          ?.status,
      ).toBe("CONFLICT");
      expect(
        (
          await push.push(
            request({ ...s, name: "Besoin convivial", version: 2 }, 1),
            "explicit",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
    }, 20000);
    it("keeps inactive codes reserved, permits other stores and refuses fabricated AI origins", async () => {
      const s = needUnitFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(s), "create");
      await push.push(
        request({ ...s, status: "INACTIVE", version: 2 }, 1),
        "archive",
      );
      const duplicate = await push.push(
        request({ ...s, id: randomUUID() }),
        "duplicate",
      );
      expect(duplicate.results[0]?.status).toBe("REJECTED");
      expect(duplicate.results[0]?.error?.code).toBe("NEED_UNIT_CODE_IN_USE");
      expect(
        (
          await push.push(
            request({ ...s, id: randomUUID(), storeId: randomUUID() }),
            "other-store",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request({ ...needUnitFixture(), createdBy: "AI" }),
            "fake-ai",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
    }, 20000);
    it("converges concurrent same-code creations to one confirmed unit with a correctable rejection", async () => {
      const a = needUnitFixture(),
        b = { ...a, id: randomUUID() },
        push = createMongoSyncPushService(database),
        ra = request(a),
        rb = request(b);
      const results = await Promise.all([
        push.push(ra, "race-a"),
        push.push(rb, "race-b"),
      ]);
      expect(
        results.filter((r) => r.results[0]?.status === "APPLIED"),
      ).toHaveLength(1);
      const losing = results[0]?.results[0]?.status === "APPLIED" ? rb : ra;
      const retried = await push.push(losing, "retry-race");
      expect(retried.results[0]?.status).toBe("REJECTED");
      expect(retried.results[0]?.error?.code).toBe("NEED_UNIT_CODE_IN_USE");
      expect(
        await (
          await database.getDb()
        )
          .collection("needUnits")
          .countDocuments({ storeId: a.storeId, code: a.code }),
      ).toBe(1);
    }, 20000);
    it("restores settings on capable bootstrap/pull and excludes them from older applications", async () => {
      const s = needUnitFixture();
      await createMongoSyncPushService(database).push(request(s), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(s.storeId, { limit: 500 })).changes).toEqual([]);
      expect(
        (await pull.pull(s.storeId, { limit: 500, needUnits: "true" }))
          .changes[0]?.entity,
      ).toMatchObject({ code: "APERITIF", status: "ACTIVE" });
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: s.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .needUnitCatalogue,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            needUnits: "true",
          })
        ).entities.needUnitCatalogue,
      ).toHaveLength(1);
    }, 20000);
  },
);
