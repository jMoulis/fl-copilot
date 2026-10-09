import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  membershipFixture,
  membershipDigest,
} from "../../../scripts/test-membership-fixtures";
import {
  needMembershipId,
  type NeedMembership,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "product need membership sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_members_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
      m: NeedMembership,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: m.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "NEED_MEMBERSHIP_UPSERT",
            entityType: "need_membership",
            entityId: m.id,
            expectedRemoteVersion: expected,
            createdAt: m.updatedAt,
            payload: m,
          },
        ],
      };
    }
    async function seed() {
      const f = await membershipFixture(),
        db = await database.getDb();
      await db
        .collection("needUnits")
        .insertOne({ ...f.need, _id: f.need.id } as never);
      const { id, ...product } = f.product;
      await db.collection("products").insertOne({
        ...product,
        _id: id,
        createdAt: new Date(product.createdAt),
        updatedAt: new Date(product.updatedAt),
      } as never);
      return f;
    }
    it("persists unknown-attribute active products and overlapping memberships with idempotent history", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database),
        r = request(f.membership);
      expect((await push.push(r, "create")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "replay")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const n = { ...f.need, id: randomUUID(), code: "SALADE", name: "Salade" };
      await (
        await database.getDb()
      )
        .collection("needUnits")
        .insertOne({ ...n, _id: n.id } as never);
      const m = {
        ...f.membership,
        id: await needMembershipId(
          f.need.storeId,
          f.product.id,
          n.id,
          membershipDigest,
        ),
        needUnitId: n.id,
      };
      expect((await push.push(request(m), "overlap")).results[0]?.status).toBe(
        "APPLIED",
      );
      expect(
        await (
          await database.getDb()
        )
          .collection("needMemberships")
          .countDocuments({ productId: f.product.id }),
      ).toBe(2);
      expect(
        await (
          await database.getDb()
        )
          .collection("needMembershipHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(2);
      expect(
        await (
          await database.getDb()
        )
          .collection("productSubstitutions")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(0);
    }, 20000);
    it("converges equivalent concurrent creation and conflicts on different declarations", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      const r = await Promise.all([
        push.push(request(f.membership), "a"),
        push.push(
          request({
            ...f.membership,
            createdAt: "2026-10-09T09:00:00Z",
            updatedAt: "2026-10-09T09:00:00Z",
          }),
          "b",
        ),
      ]);
      expect(r.every((v) => v.results[0]?.status === "APPLIED")).toBe(true);
      expect(
        await (
          await database.getDb()
        )
          .collection("needMembershipHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
      expect(
        (
          await push.push(
            request({ ...f.membership, version: 2, confidence: 0.2 }, null),
            "stale",
          )
        ).results[0]?.status,
      ).toBe("CONFLICT");
    }, 20000);
    it("waits for missing parents, rejects foreign/retired references and preserves explicit rejection", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      const badProduct = randomUUID(),
        missing = {
          ...f.membership,
          id: await needMembershipId(
            f.need.storeId,
            badProduct,
            f.need.id,
            membershipDigest,
          ),
          productId: badProduct,
        };
      expect(
        (await push.push(request(missing), "wait")).results[0],
      ).toMatchObject({
        status: "RETRYABLE_ERROR",
        error: { code: "NEED_MEMBERSHIP_PARENT_PENDING" },
      });
      const foreign = { ...f.membership, storeId: randomUUID() };
      foreign.id = await needMembershipId(
        foreign.storeId,
        foreign.productId,
        foreign.needUnitId,
        membershipDigest,
      );
      expect(
        (await push.push(request(foreign), "foreign")).results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(f.membership), "valid");
      await (
        await database.getDb()
      )
        .collection("needUnits")
        .updateOne({ _id: f.need.id } as never, {
          $set: { status: "INACTIVE" },
        });
      expect(
        (
          await push.push(
            request({ ...f.membership, version: 2 }, 1),
            "inactive",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        (
          await push.push(
            request(
              {
                ...f.membership,
                version: 2,
                status: "REJECTED",
                humanConfirmed: true,
              },
              1,
            ),
            "reject",
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
    }, 20000);
    it("excludes older clients, restores capable clients and refuses unconfirmed validation", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      expect(
        (
          await push.push(
            request({ ...f.membership, humanConfirmed: false }),
            "no-human",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(f.membership), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(f.need.storeId, { limit: 500 })).changes).toEqual(
        [],
      );
      expect(
        (
          await pull.pull(f.need.storeId, {
            limit: 500,
            needMemberships: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ productId: f.product.id, needUnitId: f.need.id });
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: f.need.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(store, { rawObservationDays: 90 })).entities
          .productNeedMemberships,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            needMemberships: "true",
          })
        ).entities.productNeedMemberships,
      ).toHaveLength(1);
    }, 20000);
  },
);
