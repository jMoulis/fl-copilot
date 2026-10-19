import { z } from "zod";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { isVisualEntityType } from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "visual library metadata canonical sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_visual_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);
    const request = (
      f: ReturnType<typeof visualLibraryFixture>,
      commands: Array<{
        type: string;
        entityType: string;
        payload: { id: string; updatedAt: string } & Record<string, unknown>;
        expected?: number | null;
      }>,
    ): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      deviceId: f.deviceId,
      storeId: f.storeId,
      commands: commands.map((c, i) => ({
        commandId: randomUUID(),
        localSequence: i + 1,
        type: c.type,
        entityType: c.entityType,
        entityId: c.payload.id,
        expectedRemoteVersion: c.expected ?? null,
        createdAt: c.payload.updatedAt,
        payload: z.json().parse(c.payload),
      })),
    });
    async function initialize() {
      const f = visualLibraryFixture(),
        db = await database.getDb();
      await db.collection("storeMemberships").insertOne({
        storeId: f.storeId,
        userId: f.actorId,
        role: "MANAGER",
        active: true,
      });
      return { f, push: createMongoSyncPushService(database), db };
    }
    const entries = (f: ReturnType<typeof visualLibraryFixture>) => [
      { type: "PRODUCT_UPSERT", entityType: "product", payload: f.product },
      {
        type: "VISUAL_ASSET_UPSERT",
        entityType: "visual_asset",
        payload: f.asset,
      },
      {
        type: "VISUAL_IDENTITY_UPSERT",
        entityType: "visual_identity",
        payload: f.identity,
      },
      {
        type: "PRODUCT_VISUAL_LINK_UPSERT",
        entityType: "product_visual_link",
        payload: f.link,
      },
    ];
    it("persists explicit approved links idempotently and negotiates metadata for bootstrap/pull", async () => {
      const { f, push, db } = await initialize(),
        input = request(f, entries(f));
      expect(
        (await push.push(input, "save", f.actorId)).results.map(
          (r) => r.status,
        ),
      ).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);
      expect(
        (await push.push(input, "replay", f.actorId)).results.map(
          (r) => r.status,
        ),
      ).toEqual([
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
      ]);
      expect(
        await db
          .collection("visualLibraryHistory")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(3);
      const store = {
        userId: f.actorId,
        sessionId: randomUUID(),
        deviceId: f.deviceId,
        storeId: f.storeId,
        storeName: "Test",
        role: "MANAGER",
      };
      const bootstrap = createMongoSyncBootstrapService(database);
      expect(
        (await bootstrap.bootstrap(store, { rawObservationDays: 90 })).entities
          .visualAssets,
      ).toBeUndefined();
      const snapshot = await bootstrap.bootstrap(store, {
        rawObservationDays: 90,
        visualLibrary: "true",
      });
      expect(snapshot.entities.visualAssets).toEqual([f.asset]);
      expect(snapshot.entities.visualIdentities).toEqual([f.identity]);
      expect(snapshot.entities.productVisualLinks).toEqual([f.link]);
      const pull = createMongoSyncPullService(database);
      expect(
        (await pull.pull(f.storeId, { limit: 500 })).changes.some((c) =>
          isVisualEntityType(c.entityType),
        ),
      ).toBe(false);
      expect(
        (
          await pull.pull(f.storeId, { limit: 500, visualLibrary: "true" })
        ).changes.filter((c) => isVisualEntityType(c.entityType)),
      ).toHaveLength(3);
      expect(
        await db
          .collection("salesObservations")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 20000);
    it("refuses forged reviewers, inactive/nonmanager memberships and immutable binary replacement", async () => {
      const { f, push, db } = await initialize();
      const forged = { ...f.asset, updatedBy: randomUUID() };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: forged }]),
            "forged",
            f.actorId,
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { role: "STAFF" } });
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "staff", f.actorId))
          .results[0]?.error?.code,
      ).toBe("VISUAL_ACCESS_INVALID");
      await db
        .collection("storeMemberships")
        .updateOne(
          { storeId: f.storeId },
          { $set: { role: "MANAGER", active: false } },
        );
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "inactive", f.actorId))
          .results[0]?.error?.code,
      ).toBe("VISUAL_ACCESS_INVALID");
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { active: true } });
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "create", f.actorId))
          .results[0]?.status,
      ).toBe("APPLIED");
      const mutated = { ...f.asset, version: 2, width: 501 };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: mutated, expected: 1 }]),
            "mutate",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_BINARY_IMMUTABLE");
    }, 20000);
    it("keeps same-hash and active-product uniqueness, refuses foreign parents, and exposes two-device conflicts", async () => {
      const { f, push } = await initialize();
      await push.push(request(f, entries(f)), "setup", f.actorId);
      expect(
        (
          await push.push(
            request(f, [
              { ...entries(f)[1]!, payload: { ...f.asset, id: randomUUID() } },
            ]),
            "same-binary",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_BINARY_EXISTS");
      expect(
        (
          await push.push(
            request(f, [
              { ...entries(f)[3]!, payload: { ...f.link, id: randomUUID() } },
            ]),
            "same-product",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_LINK_EXISTS");
      const first = {
        ...f.asset,
        version: 2,
        review: { ...f.asset.review, status: "REVOKED" as const },
      };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: first, expected: 1 }]),
            "device-a",
            f.actorId,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request(f, [
              {
                ...entries(f)[1]!,
                payload: { ...f.asset, version: 2 },
                expected: 1,
              },
            ]),
            "device-b",
            f.actorId,
          )
        ).results[0],
      ).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { review: { status: "REVOKED" } },
      });
      const foreign = await initialize();
      await foreign.push.push(
        request(foreign.f, [entries(foreign.f)[1]!]),
        "foreign-asset",
        foreign.f.actorId,
      );
      expect(
        (
          await push.push(
            request(f, [
              {
                ...entries(f)[2]!,
                payload: {
                  ...f.identity,
                  id: randomUUID(),
                  primaryAssetId: foreign.f.asset.id,
                },
              },
            ]),
            "foreign-parent",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_TARGET_UNAVAILABLE");
    }, 20000);
  },
);
