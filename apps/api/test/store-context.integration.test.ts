import {
  legacyStoreContext,
  storeContextSettingsSchema,
} from "@fl-copilot/domain";
import type { StoreContextDocument } from "../src/store-context-sync";
import { readCopilotStoreSettings } from "../src/copilot/store-settings-tool";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import type {
  StoreContextSettings,
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
      s: StoreContextSettings,
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
            type: "STORE_CONTEXT_SETTINGS_UPSERT",
            entityType: "store_context_settings",
            entityId: s.id,
            expectedRemoteVersion: expected,
            createdAt: s.updatedAt,
            payload: s,
          },
        ],
      };
    }
    it("persists one store configuration with idempotent audit and no business mutation", async () => {
      const s = storeContextFixture(),
        push = createMongoSyncPushService(database),
        r = request(s);
      expect((await push.push(r, "save")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const db = await database.getDb();
      expect(
        await db
          .collection("storeContextHistory")
          .countDocuments({ storeId: s.storeId }),
      ).toBe(1);
      for (const t of ["commercialWeekPlans", "products", "salesObservations"])
        expect(
          await db.collection(t).countDocuments({ storeId: s.storeId }),
        ).toBe(0);
    }, 20000);
    it("rejects invalid coordinates/ownership, compares two-device conflicts and accepts explicit revision", async () => {
      const s = storeContextFixture(),
        push = createMongoSyncPushService(database),
        r = request(s);
      r.storeId = randomUUID();
      expect((await push.push(r, "foreign")).results[0]?.status).toBe(
        "REJECTED",
      );
      expect(
        (await push.push(request({ ...s, locationMode: "POINT" }), "no-point"))
          .results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(s), "a");
      expect(
        (await push.push(request({ ...s, city: "Other" }), "b")).results[0]
          ?.status,
      ).toBe("CONFLICT");
      expect(
        (
          await push.push(
            request({ ...s, schoolZone: "B", version: 2 }, 1),
            "explicit",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
    }, 20000);
    it("restores settings on capable bootstrap/pull and excludes them from older applications", async () => {
      const s = storeContextFixture();
      await createMongoSyncPushService(database).push(request(s), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(s.storeId, { limit: 500 })).changes).toEqual([]);
      expect(
        (await pull.pull(s.storeId, { limit: 500, storeContext: "true" }))
          .changes[0]?.entity,
      ).toMatchObject({ city: "Asnières-sur-Seine", position: null });
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
          .storeContextSettings,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            storeContext: "true",
          })
        ).entities.storeContextSettings,
      ).toHaveLength(1);
    }, 20000);
    it("negotiates merchandising on all sync paths and preserves it through legacy writes, retries and conflicts", async () => {
      const s = {
        ...storeContextFixture(),
        merchandising: {
          activeTgCount: 2,
          implantation: "Deux îlots",
          circulation: "Allée centrale ; TG1 en premier",
          zones: [
            {
              id: randomUUID(),
              label: "TG1",
              kind: "TG" as const,
              active: true,
              position: "Première du parcours",
              heat: "HOT" as const,
              note: "Passage déclaré",
            },
          ],
        },
      };
      const push = createMongoSyncPushService(database),
        r = { ...request(s), storeMerchandising: true };
      expect((await push.push(r, "new")).results[0]).toMatchObject({
        status: "APPLIED",
        remoteEntity: { merchandising: s.merchandising },
      });
      const oldReplay = await push.push(
        { ...r, storeMerchandising: false },
        "old-replay",
      );
      expect(oldReplay.results[0]?.status).toBe("ALREADY_APPLIED");
      expect(oldReplay.results[0]?.remoteEntity).not.toHaveProperty(
        "merchandising",
      );
      const capableReplay = await push.push(r, "new-replay");
      expect(capableReplay.results[0]?.remoteEntity).toHaveProperty(
        "merchandising",
        s.merchandising,
      );
      const oldEdit = legacyStoreContext({ ...s, city: "Paris", version: 2 });
      expect(
        (await push.push(request(oldEdit, 1), "old-edit")).results[0]
          ?.remoteEntity,
      ).not.toHaveProperty("merchandising");
      const saved = await (
        await database.getDb()
      )
        .collection<StoreContextDocument>("storeContextSettings")
        .findOne({ _id: s.storeId });
      expect(saved).toMatchObject({
        version: 2,
        city: "Paris",
        merchandising: s.merchandising,
      });
      const conflict = await push.push(
        { ...request({ ...s, version: 2 }, 1), storeMerchandising: true },
        "conflict",
      );
      expect(conflict.results[0]).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { merchandising: s.merchandising },
      });
      const pull = createMongoSyncPullService(database),
        old = await pull.pull(s.storeId, { limit: 500, storeContext: "true" });
      expect(
        old.changes.every(
          (c) => !Object.hasOwn(c.entity as object, "merchandising"),
        ),
      ).toBe(true);
      const current = await pull.pull(s.storeId, {
        limit: 500,
        storeContext: "true",
        storeMerchandising: "true",
      });
      expect(current.changes[0]?.entity).toHaveProperty(
        "merchandising",
        s.merchandising,
      );
      const auth = {
        storeId: s.storeId,
        storeName: "Test",
        role: "MANAGER",
        userId: randomUUID(),
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
      const boot = createMongoSyncBootstrapService(database);
      const legacy = await boot.bootstrap(auth, {
        rawObservationDays: 90,
        storeContext: "true",
      });
      expect(legacy.entities.storeMerchandising).toBeUndefined();
      expect(legacy.entities.storeContextSettings?.[0]).not.toHaveProperty(
        "merchandising",
      );
      const capable = await boot.bootstrap(auth, {
        rawObservationDays: 90,
        storeContext: "true",
        storeMerchandising: "true",
      });
      expect(capable.entities.storeMerchandising).toBe(true);
      expect(capable.entities.storeContextSettings?.[0]).toHaveProperty(
        "merchandising",
        s.merchandising,
      );
      const read = await readCopilotStoreSettings(
        await database.getDb(),
        s.storeId,
        {},
      );
      expect(read.settings?.merchandising).toEqual(s.merchandising);
      expect(read.settings).not.toHaveProperty("position");
      expect(read.evidence[0]?.value).toContain("2 TG actives F&L");
      expect(read.evidence[0]?.value).toContain("déclarés");
      await push.push(
        {
          ...request(
            {
              ...storeContextSettingsSchema.parse(current.changes[0]!.entity),
              version: 3,
              merchandising: null,
            },
            2,
          ),
          storeMerchandising: true,
        },
        "clear",
      );
      expect(
        (await readCopilotStoreSettings(await database.getDb(), s.storeId, {}))
          .settings?.merchandising,
      ).toBeNull();
    }, 30000);
  },
);
