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
    });
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    });

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
  },
);
