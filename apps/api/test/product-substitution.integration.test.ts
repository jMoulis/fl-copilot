import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  substitutionFixture,
  substitutionDigest,
} from "../../../scripts/test-substitution-fixtures";
import {
  productSubstitutionId,
  type ProductSubstitution,
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
          MONGODB_DATABASE: `flc_substitutions_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
      m: ProductSubstitution,
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
            type: "PRODUCT_SUBSTITUTION_UPSERT",
            entityType: "product_substitution",
            entityId: m.id,
            expectedRemoteVersion: expected,
            createdAt: m.updatedAt,
            payload: m,
          },
        ],
      };
    }
    async function seed() {
      const f = await substitutionFixture(),
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
      await db.collection("products").insertOne({
        ...product,
        _id: f.substitute.id,
        label: f.substitute.label,
        createdAt: new Date(product.createdAt),
        updatedAt: new Date(product.updatedAt),
      } as never);
      return f;
    }
    it("persists unknown-attribute active products and overlapping memberships with idempotent history", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database),
        r = request(f.substitution);
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
        ...f.substitution,
        id: await productSubstitutionId(
          f.need.storeId,
          f.product.id,
          f.substitute.id,
          n.id,
          substitutionDigest,
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
          .collection("productSubstitutions")
          .countDocuments({ sourceProductId: f.product.id }),
      ).toBe(2);
      expect(
        await (
          await database.getDb()
        )
          .collection("productSubstitutionHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(2);
      expect(
        await (
          await database.getDb()
        )
          .collection("needMemberships")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(0);
    }, 20000);
    it("keeps the reverse independent, enforces the database tuple and refuses client-authored learning", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database),
        db = await database.getDb();
      await push.push(request(f.substitution), "forward");
      const reverse = {
        ...f.substitution,
        id: await productSubstitutionId(
          f.need.storeId,
          f.substitute.id,
          f.product.id,
          f.need.id,
          substitutionDigest,
        ),
        sourceProductId: f.substitute.id,
        substituteProductId: f.product.id,
        needCompatibility: 0.2,
      };
      expect(
        (await push.push(request(reverse), "reverse")).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("productSubstitutions")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(2);
      await expect(
        db
          .collection("productSubstitutions")
          .insertOne({ ...f.substitution, _id: randomUUID() } as never),
      ).rejects.toMatchObject({ code: 11000 });
      expect(
        (
          await push.push(
            request(
              {
                ...f.substitution,
                version: 2,
                relationshipScore: 0.9,
                confidence: 0.9,
                observedSubstitution: 0.9,
                evidenceCount: 1,
                lastEvidenceAt: f.substitution.updatedAt,
              },
              1,
            ),
            "fake-learning",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      const self = { ...f.substitution, substituteProductId: f.product.id };
      self.id = await productSubstitutionId(
        self.storeId,
        self.sourceProductId,
        self.substituteProductId,
        self.needUnitId,
        substitutionDigest,
      );
      expect((await push.push(request(self), "self")).results[0]?.status).toBe(
        "REJECTED",
      );
    }, 20000);
    it("converges equivalent concurrent creation and conflicts on different declarations", async () => {
      const f = await seed(),
        push = createMongoSyncPushService(database);
      const r = await Promise.all([
        push.push(request(f.substitution), "a"),
        push.push(
          request({
            ...f.substitution,
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
          .collection("productSubstitutionHistory")
          .countDocuments({ storeId: f.need.storeId }),
      ).toBe(1);
      expect(
        (
          await push.push(
            request(
              { ...f.substitution, version: 2, usageCompatibility: 0.2 },
              null,
            ),
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
          ...f.substitution,
          id: await productSubstitutionId(
            f.need.storeId,
            badProduct,
            f.substitute.id,
            f.need.id,
            substitutionDigest,
          ),
          sourceProductId: badProduct,
        };
      expect(
        (await push.push(request(missing), "wait")).results[0],
      ).toMatchObject({
        status: "RETRYABLE_ERROR",
        error: { code: "PRODUCT_SUBSTITUTION_PARENT_PENDING" },
      });
      const foreign = { ...f.substitution, storeId: randomUUID() };
      foreign.id = await productSubstitutionId(
        foreign.storeId,
        foreign.sourceProductId,
        foreign.substituteProductId,
        foreign.needUnitId,
        substitutionDigest,
      );
      expect(
        (await push.push(request(foreign), "foreign")).results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(f.substitution), "valid");
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
            request({ ...f.substitution, version: 2 }, 1),
            "inactive",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        (
          await push.push(
            request(
              {
                ...f.substitution,
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
            request({ ...f.substitution, humanConfirmed: false }),
            "no-human",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      await push.push(request(f.substitution), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(f.need.storeId, { limit: 500 })).changes).toEqual(
        [],
      );
      expect(
        (
          await pull.pull(f.need.storeId, {
            limit: 500,
            productSubstitutions: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ sourceProductId: f.product.id, needUnitId: f.need.id });
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
          .directedProductSubstitutions,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            productSubstitutions: "true",
          })
        ).entities.directedProductSubstitutions,
      ).toHaveLength(1);
    }, 20000);
  },
);
