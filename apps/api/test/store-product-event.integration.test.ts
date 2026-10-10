import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { storeEventFixture } from "../../../scripts/test-store-event-fixtures";
import {
  storeEventCapturePayload,
  type StoreProductEvent,
} from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "store product event transactions",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_store_events_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
      e: StoreProductEvent,
      type = "CREATE_STORE_EVENT",
      expected: number | null = null,
      endedAt = "2026-10-09T11:00:00Z",
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: e.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type,
            entityType: "store_product_event",
            entityId: e.id,
            expectedRemoteVersion: expected,
            createdAt: "2026-10-09T12:00:00Z",
            payload:
              type === "CREATE_STORE_EVENT"
                ? storeEventCapturePayload(e)
                : { endedAt },
          },
        ],
      };
    }
    async function seed() {
      const f = storeEventFixture(),
        { id, ...p } = f.product;
      await (await database.getDb()).collection("products").insertOne({
        ...p,
        _id: id,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      } as never);
      return f;
    }
    it("stores each of six distinct observations and exactly one history entry per replay without creating stock/metrics", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database),
        db = await database.getDb();
      for (const type of [
        "TENSION",
        "LOW_STOCK",
        "OUT_OF_STOCK",
        "QUALITY_ISSUE",
        "PRICE_INCREASE",
        "SUPPLIER_SHORTAGE",
      ] as const) {
        const e = { ...f.event, id: randomUUID(), type },
          r = request(e);
        expect((await push.push(r, "create")).results[0]?.status).toBe(
          "APPLIED",
        );
        expect((await push.push(r, "replay")).results[0]?.status).toBe(
          "ALREADY_APPLIED",
        );
      }
      expect(
        await db
          .collection("storeProductEvents")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(6);
      expect(
        await db
          .collection("storeProductEventHistory")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(6);
      expect(
        await db
          .collection("productSubstitutions")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("salesObservations")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(0);
    }, 20000);
    it("accepts pending product creation retryably and never accepts a foreign product or forged PDF origin", async () => {
      const f = storeEventFixture(),
        push = createMongoSyncPushService(database),
        r = request(f.event);
      expect((await push.push(r, "missing")).results[0]).toMatchObject({
        status: "RETRYABLE_ERROR",
        error: { code: "STORE_EVENT_PARENT_PENDING" },
      });
      const { id, ...product } = f.product;
      const db = await database.getDb();
      await db.collection("products").insertOne({
        ...product,
        _id: id,
        createdAt: new Date(product.createdAt),
        updatedAt: new Date(product.updatedAt),
      } as never);
      expect((await push.push(r, "parent-now")).results[0]?.status).toBe(
        "APPLIED",
      );
      const foreign = request({
        ...f.event,
        id: randomUUID(),
        storeId: randomUUID(),
      });
      expect((await push.push(foreign, "foreign")).results[0]?.status).toBe(
        "REJECTED",
      );
      const forged = request({ ...f.event, id: randomUUID() });
      forged.commands[0]!.payload = {
        event: {
          ...storeEventCapturePayload(f.event).event,
          id: forged.commands[0]!.entityId,
          source: "COMMERCIAL_PDF",
        },
      };
      expect(
        (await push.push(forged, "source-forgery")).results[0]?.status,
      ).toBe("REJECTED");
    }, 20000);
    it("closes once, preserves capture identity and converges two equivalent closures even with a stale version", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "create");
      const r = request(f.event, "CLOSE_STORE_EVENT", 1);
      expect((await push.push(r, "close")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "replay")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        (
          await push.push(
            request(
              f.event,
              "CLOSE_STORE_EVENT",
              1,
              "2026-10-09T13:00:00+02:00",
            ),
            "same-end",
          )
        ).results[0],
      ).toMatchObject({
        status: "APPLIED",
        remoteVersion: 2,
        remoteEntity: {
          status: "CLOSED",
          productId: f.product.id,
          startedAt: f.event.startedAt,
          endedAt: "2026-10-09T11:00:00.000Z",
        },
      });
      expect(
        await (
          await database.getDb()
        )
          .collection("storeProductEventHistory")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(2);
    }, 20000);
    it("conflicts on different end times and permits an explicit end rebase without replacing the original capture", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "create");
      await push.push(
        request(f.event, "CLOSE_STORE_EVENT", 1, "2026-10-09T10:30:00Z"),
        "a",
      );
      expect(
        (await push.push(request(f.event, "CLOSE_STORE_EVENT", 1), "b"))
          .results[0],
      ).toMatchObject({
        status: "CONFLICT",
        remoteVersion: 2,
        remoteEntity: { endedAt: "2026-10-09T10:30:00.000Z" },
      });
      expect(
        (
          await push.push(
            request(f.event, "CLOSE_STORE_EVENT", 2),
            "explicit-resolution",
          )
        ).results[0],
      ).toMatchObject({
        status: "APPLIED",
        remoteVersion: 3,
        remoteEntity: {
          type: f.event.type,
          startedAt: f.event.startedAt,
          clientCapturedAt: f.event.clientCapturedAt,
          endedAt: "2026-10-09T11:00:00.000Z",
        },
      });
    }, 20000);
    it("refuses reverse/future intervals and fields that would rewrite product/type/start or infer quantities", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "create");
      for (const end of ["2026-10-09T08:00:00Z", "2026-10-10T11:00:00Z"]) {
        expect(
          (
            await push.push(
              request(f.event, "CLOSE_STORE_EVENT", 1, end),
              "bad-end",
            )
          ).results[0]?.status,
        ).toBe("REJECTED");
      }
      const r = request(f.event, "CLOSE_STORE_EVENT", 1);
      r.commands[0]!.payload = {
        endedAt: "2026-10-09T11:00:00Z",
        productId: randomUUID(),
        type: "TENSION",
        quantity: 5,
      };
      expect((await push.push(r, "immutable")).results[0]?.status).toBe(
        "REJECTED",
      );
      expect(
        await (
          await database.getDb()
        )
          .collection("storeProductEvents")
          .findOne({ _id: f.event.id } as never),
      ).toMatchObject({
        status: "ACTIVE",
        productId: f.product.id,
        endedAt: null,
      });
    }, 20000);
    it("supports two distinct IDs for the same product and conserves a different initial capture as a conflict", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "first");
      expect(
        (await push.push(request({ ...f.event, id: randomUUID() }), "distinct"))
          .results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request({ ...f.event, type: "QUALITY_ISSUE" }),
            "same-id-different-fact",
          )
        ).results[0]?.status,
      ).toBe("CONFLICT");
      expect(
        await (
          await database.getDb()
        )
          .collection("storeProductEvents")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(2);
    }, 20000);
    it("acknowledges a new creation retry against a closed event without reopening or duplicating history", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "create");
      await push.push(request(f.event, "CLOSE_STORE_EVENT", 1), "close");
      expect(
        (await push.push(request(f.event), "retry-create-new-command"))
          .results[0],
      ).toMatchObject({
        status: "APPLIED",
        remoteVersion: 2,
        remoteEntity: { status: "CLOSED", endedAt: "2026-10-09T11:00:00.000Z" },
      });
      expect(
        await (
          await database.getDb()
        )
          .collection("storeProductEventHistory")
          .countDocuments({ storeId: f.event.storeId }),
      ).toBe(2);
    }, 20000);
    it("excludes old clients and restores capable clients through the explicit optional extension", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.event), "create");
      const pull = createMongoSyncPullService(database);
      expect(
        (await pull.pull(f.event.storeId, { limit: 500 })).changes,
      ).toEqual([]);
      expect(
        (
          await pull.pull(f.event.storeId, {
            limit: 500,
            storeProductEvents: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ id: f.event.id, source: "USER" });
      const boot = createMongoSyncBootstrapService(database),
        store = {
          storeId: f.event.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      const old = await boot.bootstrap(store, { rawObservationDays: 90 });
      expect(old.entities.storeEvents).toEqual([]);
      expect(old.entities.productStoreEvents).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            storeProductEvents: "true",
          })
        ).entities.productStoreEvents,
      ).toHaveLength(1);
    }, 20000);
  },
);
