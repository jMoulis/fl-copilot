import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  allocationSqliteFixture,
  AllocationSqliteAdapter,
} from "../../../scripts/test-physical-allocation-sqlite";
import { testChoiceDigest } from "../../../scripts/test-commercial-choice-fixtures";
import { nextLayout } from "../../../scripts/test-store-layout-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { CommercialPreparationRepository } from "../../mobile/src/commercial/week-preparation-repository";
import { CommercialPlanRepository } from "../../mobile/src/commercial/week-plan-repository";
import { readWeekPlanContext } from "../../mobile/src/commercial/week-plan-context";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import {
  legacyPhysicalPreparation,
  layoutScenarioInput,
} from "@fl-copilot/domain";
import type {
  SyncPushRequest,
  CommercialWeekPreparation,
} from "@fl-copilot/sync-contracts";
import { readPreparationPreview } from "../src/copilot/preparation-preview-tool";
import { previewCommercialPlanValidation } from "../src/copilot/plan-validation-tool";
import { readStoreLayoutScenarioSources } from "../src/copilot/store-layout-scenario-tool";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "canonical physical allocation in commercial preparation",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_link_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    }, 60000);
    async function seed() {
      const s = await allocationSqliteFixture(":memory:", true),
        db = await database.getDb(),
        p = (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))!.entity;
      await db
        .collection<{ _id: string; [key: string]: unknown }>(
          "commercialWeekPreparations",
        )
        .insertOne({ _id: p.id, ...p });
      await db
        .collection<{ _id: string; [key: string]: unknown }>("storeLayouts")
        .insertOne({ _id: s.f.storeId, ...s.f.layout.reference });
      for (const plan of [s.f.layout.first, s.f.layout.reference])
        await db
          .collection<{ _id: string; [key: string]: unknown }>(
            "storeLayoutRevisions",
          )
          .insertOne({
            _id: plan.revisionId,
            id: plan.revisionId,
            storeId: s.f.storeId,
            plan,
            version: 1,
          });
      for (const product of s.f.layout.sources.products) {
        const { id, ...data } = product;
        await db
          .collection<{ _id: string; [key: string]: unknown }>("products")
          .insertOne({
            _id: id,
            ...data,
            schemaVersion: 1,
            createdAt: new Date(product.createdAt),
            updatedAt: new Date(product.updatedAt),
            deletedAt: null,
          });
      }
      await db
        .collection<{ _id: string; [key: string]: unknown }>(
          "commercialOfferChoices",
        )
        .insertOne({
          _id: s.f.choice.id,
          ...s.f.choice,
          duplicateKey: randomUUID(),
        });
      await db
        .collection<{ _id: string; [key: string]: unknown }>(
          "commercialValidatedOffers",
        )
        .insertOne({ _id: s.f.validated.id, ...s.f.validated });
      await db
        .collection<{ _id: string; [key: string]: unknown }>(
          "commercialVisualReadings",
        )
        .insertOne({ _id: s.f.reading.id, ...s.f.reading });
      return { ...s, mongo: db, previous: p };
    }
    const request = (
      p: CommercialWeekPreparation,
      expected: number | null,
      physicalAllocations = true,
    ): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      storeId: p.storeId,
      deviceId: randomUUID(),
      physicalAllocations,
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
    });
    it("links offline, syncs once, separately validates the commercial plan and restores the same allocation on another SQLite device", async () => {
      const s = await seed(),
        other = new DatabaseSync(":memory:");
      try {
        const push = createMongoSyncPushService(database),
          pull = createMongoSyncPullService(database),
          boot = createMongoSyncBootstrapService(database);
        const transport = {
          push: (r: SyncPushRequest) => push.push(r, "link", s.chat.ownerId),
          pull: (storeId: string, cursor: string) =>
            pull.pull(storeId, {
              cursor,
              limit: 500,
              commercialPreparation: "true",
              commercialChoices: "true",
              commercialPlans: "true",
              commercialValidation: "true",
              commercialVisual: "true",
              storeLayouts: "true",
              physicalAllocations: "true",
            }),
          bootstrap: (storeId: string) =>
            boot.bootstrap(
              {
                storeId,
                storeName: "Test",
                role: "MANAGER",
                userId: s.chat.ownerId,
                sessionId: randomUUID(),
                deviceId: randomUUID(),
              },
              {
                rawObservationDays: 90,
                commercialPreparation: "true",
                commercialChoices: "true",
                commercialPlans: "true",
                commercialValidation: "true",
                commercialVisual: "true",
                storeLayouts: "true",
                physicalAllocations: "true",
              },
            ),
        };
        const options = {
            appVersion: "test",
            deviceId: s.scope.deviceId,
            commercialPreparation: true,
            commercialChoices: true,
            commercialPlans: true,
            commercialValidation: true,
            commercialVisual: true,
            storeLayouts: true,
            physicalAllocations: true,
          },
          sync = new MobileSyncService(s.a, transport, options);
        const state = await s.controller.open(s.message);
        await s.controller.confirm(s.message, state.before);
        await sync.sync(s.f.storeId);
        const prep = (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))!;
        expect(prep.syncState).toBe("SYNCED");
        expect(prep.entity.physicalAllocation).toEqual(s.f.scenario);
        expect(prep.entity.note).toEqual(s.previous.note);
        expect(
          await s.mongo
            .collection("commercialPreparationHistory")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(1);
        expect(
          await s.mongo
            .collection("commercialWeekPlans")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(0);
        const plan = await buildCommercialWeekPlan(
          {
            preparation: prep.entity,
            version: 1,
            createdAt: prep.entity.createdAt,
            validatedAt: s.now(),
          },
          await readWeekPlanContext(s.a, prep.entity),
          testChoiceDigest,
        );
        await new CommercialPlanRepository(s.a, testChoiceDigest).save(plan, {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
        });
        await sync.sync(s.f.storeId);
        const a = new AllocationSqliteAdapter(other);
        await runLocalMigrations(a);
        await new MobileSyncService(a, transport, {
          ...options,
          deviceId: randomUUID(),
        }).sync(s.f.storeId);
        expect(
          (
            await new CommercialPreparationRepository(a, testChoiceDigest).get(
              s.f.storeId,
              s.f.scenario.weekStart,
            )
          )?.entity,
        ).toEqual(prep.entity);
        expect(
          (
            await new CommercialPlanRepository(a, testChoiceDigest).get(
              s.f.storeId,
              s.f.scenario.weekStart,
            )
          )?.entity,
        ).toEqual(plan);
        expect(
          await s.mongo
            .collection("commercialExecutionTasks")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(0);
        expect(
          await s.mongo
            .collection("storeLayoutRevisions")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(2);
      } finally {
        s.db.close();
        other.close();
      }
    });
    it("refuses changed physical/product sources on push, while a missing unsynced dependency remains retryable", async () => {
      const s = await seed();
      try {
        const state = await s.controller.open(s.message);
        await s.controller.confirm(s.message, state.before);
        const p = (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))!
            .entity,
          r = request(p, 1),
          push = createMongoSyncPushService(database);
        await s.mongo
          .collection("products")
          .updateOne({ _id: s.f.layout.product.id } as never, {
            $inc: { version: 1 },
          });
        expect((await push.push(r, "changed")).results[0]).toMatchObject({
          status: "REJECTED",
          error: { code: "PHYSICAL_ALLOCATION_SOURCES_CHANGED" },
        });
        await s.mongo
          .collection("products")
          .updateOne({ _id: s.f.layout.product.id } as never, {
            $set: { version: 1 },
          });
        await s.mongo
          .collection("storeLayouts")
          .deleteOne({ _id: s.f.storeId } as never);
        const pending = request(p, 1);
        expect((await push.push(pending, "pending")).results[0]?.status).toBe(
          "RETRYABLE_ERROR",
        );
        await s.mongo
          .collection<{ _id: string; [key: string]: unknown }>("storeLayouts")
          .insertOne({ _id: s.f.storeId, ...s.f.layout.reference });
        expect((await push.push(pending, "retry")).results[0]?.status).toBe(
          "APPLIED",
        );
      } finally {
        s.db.close();
      }
    });
    it("projects legacy bootstrap/pull/ack shapes, preserves full replay, and rejects implicit legacy erasure", async () => {
      const s = await seed();
      try {
        const p = { ...s.f.linked, note: s.previous.note },
          r = request(p, 1),
          push = createMongoSyncPushService(database);
        expect((await push.push(r, "link")).results[0]?.status).toBe("APPLIED");
        expect(
          (
            await push.push(
              { ...r, physicalAllocations: false },
              "legacy-replay",
            )
          ).results[0]?.remoteEntity,
        ).not.toHaveProperty("physicalAllocation");
        expect(
          (await push.push(r, "full-replay")).results[0]?.remoteEntity,
        ).toMatchObject({ physicalAllocation: s.f.scenario });
        const legacy = {
          ...legacyPhysicalPreparation(p),
          version: p.version + 1,
        };
        expect(
          (await push.push(request(legacy, p.version, false), "old-save"))
            .results[0],
        ).toMatchObject({
          status: "REJECTED",
          error: { code: "PHYSICAL_ALLOCATION_CLIENT_REQUIRED" },
        });
        const boot = createMongoSyncBootstrapService(database),
          ctx = {
            storeId: s.f.storeId,
            storeName: "Test",
            role: "MANAGER",
            userId: s.chat.ownerId,
            sessionId: randomUUID(),
            deviceId: randomUUID(),
          };
        const old = await boot.bootstrap(ctx, {
            rawObservationDays: 90,
            commercialPreparation: "true",
          }),
          full = await boot.bootstrap(ctx, {
            rawObservationDays: 90,
            commercialPreparation: "true",
            physicalAllocations: "true",
          });
        expect(old.entities.commercialWeekPreparations?.[0]).not.toHaveProperty(
          "physicalAllocation",
        );
        expect(full.entities.physicalAllocations).toBe(true);
        expect(full.entities.commercialWeekPreparations?.[0]).toMatchObject({
          physicalAllocation: s.f.scenario,
        });
        const pull = createMongoSyncPullService(database);
        expect(
          (
            await pull.pull(s.f.storeId, {
              limit: 500,
              commercialPreparation: "true",
            })
          ).changes[0]?.entity,
        ).not.toHaveProperty("physicalAllocation");
        expect(
          (
            await pull.pull(s.f.storeId, {
              limit: 500,
              commercialPreparation: "true",
              physicalAllocations: "true",
            })
          ).changes[0]?.entity,
        ).toMatchObject({ physicalAllocation: s.f.scenario });
        await expect(
          readPreparationPreview(s.mongo, s.f.storeId, {
            weekStart: p.weekStart,
            patch: { note: "Nouvelle note" },
          }),
        ).rejects.toThrow("CLIENT_REQUIRED");
        await expect(
          previewCommercialPlanValidation(s.mongo, s.f.storeId, {
            weekStart: p.weekStart,
          }),
        ).rejects.toThrow("CLIENT_REQUIRED");
        expect(
          (
            await readPreparationPreview(
              s.mongo,
              s.f.storeId,
              { weekStart: p.weekStart, patch: { note: "Nouvelle note" } },
              true,
            )
          ).status,
        ).toBe("READY");
      } finally {
        s.db.close();
      }
    });
    it("blocks commercial approval after adoption changes without rewriting the historical allocation", async () => {
      const s = await seed();
      try {
        const p = { ...s.f.linked, note: s.previous.note },
          push = createMongoSyncPushService(database);
        expect(
          (await push.push(request(p, 1), "link")).results[0]?.status,
        ).toBe("APPLIED");
        const sources = await readStoreLayoutScenarioSources(
          s.mongo,
          s.f.storeId,
          layoutScenarioInput(s.f.scenario),
        );
        expect(sources.layout.reference?.revisionId).toBe(
          s.f.scenario.physicalRevisionId,
        );
        const candidate = await buildCommercialWeekPlan(
          {
            preparation: p,
            version: 1,
            createdAt: p.createdAt,
            validatedAt: s.now(),
          },
          { ...s.f.context, preparation: p },
          testChoiceDigest,
        );
        const id = randomUUID(),
          head = nextLayout(s.f.layout.reference, {
            action: "ADOPT_REFERENCE",
            revisionId: id,
            referenceRevisionId: id,
          });
        await s.mongo
          .collection<{ _id: string; [key: string]: unknown }>("storeLayouts")
          .replaceOne({ _id: s.f.storeId }, { _id: s.f.storeId, ...head });
        const review = await previewCommercialPlanValidation(
          s.mongo,
          s.f.storeId,
          { weekStart: p.weekStart },
          undefined,
          true,
        );
        expect(review.status).toBe("BLOCKED");
        expect(review.issues).toContainEqual(
          expect.objectContaining({
            code: "PHYSICAL_ALLOCATION_REVIEW_REQUIRED",
          }),
        );
        const planRequest: SyncPushRequest = {
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: randomUUID(),
          storeId: s.f.storeId,
          physicalAllocations: true,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: "COMMERCIAL_WEEK_PLAN_UPSERT",
              entityType: "commercial_week_plan",
              entityId: candidate.id,
              expectedRemoteVersion: null,
              createdAt: candidate.updatedAt,
              payload: candidate,
            },
          ],
        };
        expect(
          (await push.push(planRequest, "approve-stale")).results[0]?.status,
        ).toBe("REJECTED");
        expect(
          (
            await s.mongo
              .collection("commercialWeekPreparations")
              .findOne({ _id: p.id } as never)
          )?.physicalAllocation,
        ).toEqual(s.f.scenario);
        expect(
          await s.mongo
            .collection("commercialWeekPlans")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(0);
      } finally {
        s.db.close();
      }
    });
  },
);
