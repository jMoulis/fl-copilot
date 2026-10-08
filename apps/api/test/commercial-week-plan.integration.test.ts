import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { commercialPlanFixture } from "../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../scripts/test-commercial-choice-fixtures";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import type {
  CommercialWeekPlan,
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
  "validated weekly plans",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_plan_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
      const f = await commercialPlanFixture(),
        db = await database.getDb();
      const { id: productId, ...product } = f.product;
      await db
        .collection<{ _id: string; createdAt: Date; updatedAt: Date }>(
          "products",
        )
        .insertOne({
          ...product,
          _id: productId,
          createdAt: new Date(f.product.createdAt),
          updatedAt: new Date(f.product.updatedAt),
        });
      for (const [name, value] of [
        ["commercialVisualReadings", f.reading],
        ["commercialOfferChoices", f.choice],
        ["commercialWeekPreparations", f.preparation],
        ["commercialValidatedOffers", f.validated],
      ] as const)
        await db
          .collection<{ _id: string }>(name)
          .insertOne({ ...value, _id: value.id });
      return { ...f, db };
    }
    function request(
      plan: CommercialWeekPlan,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: plan.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COMMERCIAL_WEEK_PLAN_UPSERT",
            entityType: "commercial_week_plan",
            entityId: plan.id,
            expectedRemoteVersion: expected,
            createdAt: plan.validatedAt,
            payload: plan,
          },
        ],
      };
    }
    it("publishes plan, canonical operations/offers and immutable history once without recording execution or changing observations", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.plan);
      expect((await push.push(r, "first")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      for (const t of [
        "commercialWeekPlans",
        "commercialOperations",
        "offers",
        "commercialPlanRevisions",
      ])
        expect(
          await x.db.collection(t).countDocuments({ storeId: x.storeId }),
        ).toBe(1);
      expect(
        await x.db
          .collection("commercialOperations")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ planningStatus: "PLANNED", actualStart: null });
      for (const t of [
        "actionExecutions",
        "salesObservations",
        "wasteObservations",
      ])
        expect(
          await x.db.collection(t).countDocuments({ storeId: x.storeId }),
        ).toBe(0);
      expect(
        await x.db
          .collection("commercialWeekPreparations")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ status: "DRAFT", version: 1 });
    }, 20000);
    it("waits for an earlier validation dependency but rejects changed drafts/choices/products and forged publication data", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await x.db
        .collection<{ _id: string }>("commercialValidatedOffers")
        .deleteOne({ _id: x.validated.id });
      const r = request(x.plan);
      expect((await push.push(r, "pending")).results[0]?.status).toBe(
        "RETRYABLE_ERROR",
      );
      await x.db
        .collection<{ _id: string }>("commercialValidatedOffers")
        .insertOne({ ...x.validated, _id: x.validated.id });
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
        (await push.push(request(y.plan), "withdrawn")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_PLAN_CHOICE_CHANGED");
      const z = await seed();
      const fake = {
        ...z.plan,
        offers: z.plan.offers.map((o) => ({
          ...o,
          customerMechanism: {
            type: "FIXED_PRICE" as const,
            currency: "EUR" as const,
            unit: "KG" as const,
            amount: 99,
          },
        })),
      };
      expect(
        (await push.push(request(fake), "forged")).results[0]?.status,
      ).toBe("REJECTED");
      await z.db
        .collection<{ _id: string }>("products")
        .updateOne(
          { _id: z.productId },
          { $set: { version: 2, label: "changed" } },
        );
      expect(
        (await push.push(request(z.plan), "product")).results[0]?.error?.code,
      ).toBe("COMMERCIAL_PLAN_PRODUCT_CHANGED");
    }, 20000);
    it("preserves two-device decisions as a conflict, accepts explicit new revision, and never replays an old plan over newer projections", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.plan);
      await push.push(r, "a");
      expect(
        (
          await push.push(
            request(
              await buildCommercialWeekPlan(
                {
                  preparation: x.preparation,
                  version: 1,
                  createdAt: x.plan.createdAt,
                  validatedAt: new Date().toISOString(),
                },
                x.context,
                testChoiceDigest,
              ),
            ),
            "b",
          )
        ).results[0]?.status,
      ).toBe("CONFLICT");
      const prep = { ...x.preparation, note: "new prep", version: 2 };
      await x.db
        .collection<{ _id: string }>("commercialWeekPreparations")
        .replaceOne({ _id: prep.id }, { ...prep, _id: prep.id });
      const plan = await buildCommercialWeekPlan(
        {
          preparation: prep,
          version: 2,
          createdAt: x.plan.createdAt,
          validatedAt: "2026-10-08T13:00:00.000Z",
        },
        { ...x.context, preparation: prep },
        testChoiceDigest,
      );
      expect(
        (await push.push(request(plan, 1), "revision")).results[0]?.status,
      ).toBe("APPLIED");
      expect((await push.push(r, "old-retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await x.db.collection("offers").findOne({ storeId: x.storeId }),
      ).toMatchObject({ version: 2 });
      expect(
        await x.db
          .collection("commercialPlanRevisions")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(2);
    }, 20000);
    it("restores current plans and every confirmed revision on capable bootstrap/pull while protecting older clients", async () => {
      const x = await seed();
      await createMongoSyncPushService(database).push(request(x.plan), "saved");
      const pull = createMongoSyncPullService(database);
      const old = await pull.pull(x.storeId, { limit: 500 });
      expect(old.changes).toEqual([]);
      const page = await pull.pull(x.storeId, {
        limit: 500,
        commercialPlans: "true",
      });
      expect(page.changes.map((c) => c.entityType)).toEqual([
        "commercial_week_plan",
        "commercial_week_plan_revision",
      ]);
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
          .commercialWeekPlans,
      ).toBeUndefined();
      const snapshot = await boot.bootstrap(store, {
        rawObservationDays: 90,
        commercialPlans: "true",
      });
      expect(snapshot.entities.commercialWeekPlans).toHaveLength(1);
      expect(snapshot.entities.commercialPlanRevisions).toHaveLength(1);
      expect(snapshot.entities.commercialOperations).toEqual([]);
    }, 20000);
    it("rejects cross-store roots, fabricated execution and changed reference choices without touching canonical collections", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const r = request(x.plan);
      r.storeId = randomUUID();
      expect((await push.push(r, "tenant")).results[0]?.status).toBe(
        "REJECTED",
      );
      const bad = request(x.plan);
      bad.commands[0]!.payload = {
        ...x.plan,
        operations: x.plan.operations.map((o) => ({
          ...o,
          planningStatus: "EXECUTED",
        })),
      };
      expect((await push.push(bad, "execute")).results[0]?.status).toBe(
        "REJECTED",
      );
      for (const t of ["commercialWeekPlans", "commercialOperations", "offers"])
        expect(
          await x.db.collection(t).countDocuments({ storeId: x.storeId }),
        ).toBe(0);
    }, 20000);
  },
);
