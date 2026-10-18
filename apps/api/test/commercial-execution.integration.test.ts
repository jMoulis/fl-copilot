import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { testChoiceDigest } from "../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CommercialExecutionRepository } from "../../mobile/src/commercial/execution-repository";
import { applyCommercialPlan } from "../../mobile/src/commercial/week-plan-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { commercialExecutionFixture } from "../../../scripts/test-commercial-execution-fixtures";
import type {
  CommercialExecutionTask,
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
  "commercial execution capture",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_exec_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
      const f = await commercialExecutionFixture(),
        db = await database.getDb(),
        revision = {
          id: f.plan.revisionId,
          storeId: f.storeId,
          plan: f.plan,
          version: 1,
        };
      await db
        .collection<{ _id: string }>("commercialPlanRevisions")
        .insertOne({ ...revision, _id: revision.id });
      return { ...f, db, revision };
    }
    function request(
      t: CommercialExecutionTask,
      expected: number | null = null,
    ): SyncPushRequest {
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId: randomUUID(),
        storeId: t.storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COMMERCIAL_EXECUTION_TASK_UPSERT",
            entityType: "commercial_execution_task",
            entityId: t.id,
            expectedRemoteVersion: expected,
            createdAt: t.updatedAt,
            payload: t,
          },
        ],
      };
    }
    it("records only the declared task once with audit/sync, never a whole promotion or price/KPI mutation", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database),
        r = request(x.task);
      expect((await push.push(r, "first")).results[0]?.status).toBe("APPLIED");
      expect((await push.push(r, "retry")).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      expect(
        await x.db
          .collection("commercialExecutionHistory")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(1);
      for (const t of [
        "commercialOperations",
        "offers",
        "salesObservations",
        "wasteObservations",
      ])
        expect(
          await x.db.collection(t).countDocuments({ storeId: x.storeId }),
        ).toBe(0);
      expect(
        await x.db
          .collection("commercialPlanRevisions")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ plan: { status: "VALIDATED" } });
    }, 20000);
    it("waits for the plan revision dependency and retries the same field declaration", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await x.db
        .collection<{ _id: string }>("commercialPlanRevisions")
        .deleteOne({ _id: x.revision.id });
      const r = request(x.task);
      expect((await push.push(r, "pending")).results[0]?.status).toBe(
        "RETRYABLE_ERROR",
      );
      await x.db
        .collection<{ _id: string }>("commercialPlanRevisions")
        .insertOne({ ...x.revision, _id: x.revision.id });
      expect((await push.push(r, "arrived")).results[0]?.status).toBe(
        "APPLIED",
      );
    }, 20000);
    it("rejects wrong stores, targets and plan-copy fingerprints while preserving local declarations for review", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const r = request(x.task);
      r.storeId = randomUUID();
      expect((await push.push(r, "tenant")).results[0]?.status).toBe(
        "REJECTED",
      );
      expect(
        (await push.push(request({ ...x.task, label: "forged" }), "target"))
          .results[0]?.error?.code,
      ).toBe("COMMERCIAL_EXECUTION_PLAN_CHANGED");
      const wrong = { ...x.task, planChecksum: "a".repeat(64) };
      expect(
        (await push.push(request(wrong), "checksum")).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        (
          await push.push(
            request({
              ...x.task,
              status: "NOT_APPLICABLE",
              completedAt: null,
              note: "",
            }),
            "no-reason",
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
    }, 20000);
    it("preserves contradictory two-device status/note choices as a conflict and accepts explicit rebase", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      await push.push(request(x.task), "a");
      const skipped = {
        ...x.task,
        status: "SKIPPED" as const,
        completedAt: null,
        note: "Pas imprimée",
      };
      expect((await push.push(request(skipped), "b")).results[0]).toMatchObject(
        { status: "CONFLICT", remoteEntity: { status: "DONE" } },
      );
      expect(
        (await push.push(request({ ...skipped, version: 2 }, 1), "resolved"))
          .results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await x.db
          .collection("commercialExecutionHistory")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(2);
    }, 20000);
    it("restores tasks for capable apps and excludes them from older bootstrap/pull clients", async () => {
      const x = await seed();
      await createMongoSyncPushService(database).push(request(x.task), "save");
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(x.storeId, { limit: 500 })).changes).toEqual([]);
      expect(
        (
          await pull.pull(x.storeId, {
            limit: 500,
            commercialExecution: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ status: "DONE", planRevisionId: x.plan.revisionId });
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
          .commercialExecutionTasks,
      ).toBeUndefined();
      expect(
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            commercialExecution: "true",
          })
        ).entities.commercialExecutionTasks,
      ).toHaveLength(1);
    }, 20000);

    it("syncs actual details with opt-in, projects all legacy responses, and preserves them on an older client's update", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const actuals = {
        start: "2026-10-08",
        end: "2026-10-09",
        price: "0",
        priceUnit: "KG" as const,
        location: "TG entrée",
      };
      const r = {
        ...request({ ...x.task, actuals, updatedAt: "2026-10-18T12:00:00Z" }),
        commercialExecutionActuals: true,
      };
      expect((await push.push(r, "details")).results[0]).toMatchObject({
        status: "APPLIED",
        remoteEntity: { actuals },
      });
      expect(
        (
          await push.push(
            { ...r, commercialExecutionActuals: false },
            "legacy-replay",
          )
        ).results[0]?.remoteEntity,
      ).not.toHaveProperty("actuals");
      const pull = createMongoSyncPullService(database);
      expect(
        (
          await pull.pull(x.storeId, {
            limit: 500,
            commercialExecution: "true",
          })
        ).changes[0]?.entity,
      ).not.toHaveProperty("actuals");
      expect(
        (
          await pull.pull(x.storeId, {
            limit: 500,
            commercialExecution: "true",
            commercialExecutionActuals: "true",
          })
        ).changes[0]?.entity,
      ).toMatchObject({ actuals });
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
        (
          await boot.bootstrap(store, {
            rawObservationDays: 90,
            commercialExecution: "true",
          })
        ).entities.commercialExecutionTasks?.[0],
      ).not.toHaveProperty("actuals");
      const snapshot = await boot.bootstrap(store, {
        rawObservationDays: 90,
        commercialExecution: "true",
        commercialExecutionActuals: "true",
      });
      expect(snapshot.entities.commercialExecutionActuals).toBe(true);
      expect(snapshot.entities.commercialExecutionTasks?.[0]).toMatchObject({
        actuals,
      });
      // Older software reopens status without ever seeing actual details: preserve them on the canonical head.
      const legacy = request(
        {
          ...x.task,
          status: "TODO",
          completedAt: null,
          note: "À revoir",
          version: 2,
        },
        1,
      );
      expect(
        (await push.push(legacy, "legacy-update")).results[0]?.remoteEntity,
      ).not.toHaveProperty("actuals");
      expect(
        await x.db
          .collection("commercialExecutionTasks")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ version: 2, status: "TODO", actuals });
      expect(
        await x.db
          .collection("commercialExecutionHistory")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(2);
    }, 60000);
    it("keeps competing actual locations in a version conflict and clears only on an explicit reviewed revision", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const actuals = {
        start: null,
        end: null,
        price: null,
        priceUnit: null,
        location: "TG entrée",
      };
      const first = {
        ...request({ ...x.task, actuals, updatedAt: "2026-10-18T12:00:00Z" }),
        commercialExecutionActuals: true,
      };
      await push.push(first, "first");
      const contender = {
        ...request(
          {
            ...x.task,
            actuals: { ...actuals, location: "TG fond" },
            version: 2,
          },
          1,
        ),
        commercialExecutionActuals: true,
      };
      await push.push(contender, "second");
      expect(
        (
          await push.push(
            {
              ...request({ ...x.task, actuals, version: 2 }, 1),
              commercialExecutionActuals: true,
            },
            "stale",
          )
        ).results[0],
      ).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { actuals: { location: "TG fond" } },
      });
      expect(
        (
          await push.push(
            request({ ...x.task, version: 2 }, 1),
            "legacy-conflict",
          )
        ).results[0]?.remoteEntity,
      ).not.toHaveProperty("actuals");
      const clear = {
        ...request({ ...x.task, actuals: null, version: 3 }, 2),
        commercialExecutionActuals: true,
      };
      expect((await push.push(clear, "clear")).results[0]).toMatchObject({
        status: "APPLIED",
        remoteEntity: { actuals: null },
      });
      await push.push(first, "late-old-replay");
      expect(
        await x.db
          .collection("commercialExecutionTasks")
          .findOne({ storeId: x.storeId }),
      ).toMatchObject({ version: 3, actuals: null });
      expect(
        await x.db
          .collection("commercialExecutionHistory")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(3);
    }, 60000);
    it("rejects future or contradictory actual dates without canonical writes", async () => {
      const x = await seed(),
        push = createMongoSyncPushService(database);
      const actuals = {
        start: "2099-01-01",
        end: null,
        price: null,
        priceUnit: null,
        location: null,
      };
      expect(
        (await push.push(request({ ...x.task, actuals }), "future")).results[0],
      ).toMatchObject({
        status: "REJECTED",
        error: { code: "COMMERCIAL_EXECUTION_ACTUALS_INVALID" },
      });
      expect(
        await x.db
          .collection("commercialExecutionTasks")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(0);
      expect(
        await x.db
          .collection("commercialExecutionHistory")
          .countDocuments({ storeId: x.storeId }),
      ).toBe(0);
    }, 60000);

    it("moves an offline SQLite declaration and actual details through Outbox/Mongo and restores them on another native database exactly once", async () => {
      const x = await seed(),
        first = new MercalysTestDatabase(),
        second = new MercalysTestDatabase();
      try {
        await x.db
          .collection<{ _id: string }>("commercialWeekPlans")
          .insertOne({ _id: x.plan.id, ...x.plan });
        for (const device of [first, second]) await runLocalMigrations(device);
        await applyCommercialPlan(first, x.storeId, x.plan);
        const actuals = {
          start: "2026-10-08",
          end: "2026-10-09",
          price: "1.89",
          priceUnit: "KG" as const,
          location: "TG entrée",
        };
        const task = { ...x.task, actuals, updatedAt: "2026-10-18T12:00:00Z" };
        const repo = new CommercialExecutionRepository(first, testChoiceDigest),
          deviceId = randomUUID();
        await repo.save(task, { commandId: randomUUID(), deviceId });
        expect((await repo.get(x.storeId, task.id))?.syncState).toBe("PENDING");
        const push = createMongoSyncPushService(database),
          pull = createMongoSyncPullService(database),
          boot = createMongoSyncBootstrapService(database),
          authority = {
            storeId: x.storeId,
            storeName: "Test",
            role: "MANAGER" as const,
            userId: randomUUID(),
            sessionId: randomUUID(),
            deviceId,
          },
          q = {
            commercialExecution: "true" as const,
            commercialExecutionActuals: "true" as const,
            commercialPlans: "true" as const,
          };
        const sync = (device: MercalysTestDatabase) =>
          new MobileSyncService(
            device,
            {
              push: (r) => push.push(r, randomUUID()),
              pull: (storeId, cursor) =>
                pull.pull(storeId, { ...q, cursor, limit: 500 }),
              bootstrap: () =>
                boot.bootstrap(authority, { ...q, rawObservationDays: 90 }),
            },
            {
              appVersion: "test",
              deviceId,
              commercialExecution: true,
              commercialExecutionActuals: true,
              commercialPlans: true,
            },
          );
        await sync(first).sync(x.storeId);
        await sync(first).sync(x.storeId);
        expect(await repo.get(x.storeId, task.id)).toMatchObject({
          syncState: "SYNCED",
          entity: { actuals },
        });
        await sync(second).sync(x.storeId);
        expect(
          await new CommercialExecutionRepository(second, testChoiceDigest).get(
            x.storeId,
            task.id,
          ),
        ).toMatchObject({ syncState: "SYNCED", entity: { actuals } });
        expect(
          await x.db
            .collection("commercialExecutionHistory")
            .countDocuments({ storeId: x.storeId }),
        ).toBe(1);
      } finally {
        first.db.close();
        second.db.close();
      }
    }, 60000);
  },
);
