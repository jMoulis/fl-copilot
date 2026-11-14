import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { PersonalTaskRepository } from "../../mobile/src/journal/personal-task-repository";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import type { PersonalTask } from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "owner-private daily tasks",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE:
            "personal_" + randomUUID().replaceAll("-", "").slice(0, 18),
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
    const fixture = () => {
      const storeId = randomUUID(),
        ownerId = randomUUID();
      const task: PersonalTask = {
        id: randomUUID(),
        storeId,
        ownerId,
        text: "Vérifier les avocats",
        date: "2026-11-14",
        time: "16:00",
        status: "TODO",
        version: 1,
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-11-14T08:00:00.000Z",
        updatedAt: "2026-11-14T08:00:00.000Z",
      };
      return {
        scope: { storeId, ownerId },
        task,
        store: {
          storeId,
          userId: ownerId,
          storeName: "Test",
          role: "MANAGER" as const,
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
      };
    };
    const request = (task: PersonalTask): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      storeId: task.storeId,
      deviceId: randomUUID(),
      commands: [
        {
          commandId: randomUUID(),
          localSequence: 1,
          type: "PERSONAL_TASK_UPSERT",
          entityType: "personal_task",
          entityId: task.id,
          expectedRemoteVersion: task.version === 1 ? null : task.version - 1,
          payload: task,
          createdAt: task.updatedAt,
        },
      ],
    });
    it("replays exactly once and protects cached acknowledgements, bootstrap and pull from other owners and legacy clients", async () => {
      const f = fixture(),
        push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        boot = createMongoSyncBootstrapService(database),
        r = request(f.task);
      expect(
        (await push.push(r, "first", f.scope.ownerId)).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (await push.push(r, "replay", f.scope.ownerId)).results[0]?.status,
      ).toBe("ALREADY_APPLIED");
      const denied = await push.push(r, "foreign-replay", randomUUID());
      expect(denied.results[0]?.status).toBe("REJECTED");
      expect(denied.results[0]?.remoteEntity).toBeUndefined();
      const snapshot = await boot.bootstrap(f.store, {
        rawObservationDays: 90,
        personalTasks: "true",
      });
      expect(snapshot.entities.personalTasks).toEqual([f.task]);
      expect(snapshot.entities.personalTasksOwnerId).toBe(f.scope.ownerId);
      expect(
        (
          await boot.bootstrap(
            { ...f.store, userId: randomUUID() },
            { rawObservationDays: 90, personalTasks: "true" },
          )
        ).entities.personalTasks,
      ).toEqual([]);
      expect(
        (await boot.bootstrap(f.store, { rawObservationDays: 90 })).entities
          .personalTasks,
      ).toBeUndefined();
      const own = await pull.pull(
        f.scope.storeId,
        { limit: 500, personalTasks: "true" },
        f.scope.ownerId,
      );
      expect(
        own.changes.filter((c) => c.entityType === "personal_task"),
      ).toHaveLength(1);
      expect(
        (
          await pull.pull(
            f.scope.storeId,
            { limit: 500, personalTasks: "true" },
            randomUUID(),
          )
        ).changes.filter((c) => c.entityType === "personal_task"),
      ).toEqual([]);
      expect(
        (
          await pull.pull(
            f.scope.storeId,
            { limit: 500, copilotHistory: "true" },
            f.scope.ownerId,
          )
        ).changes.filter((c) => c.entityType === "personal_task"),
      ).toEqual([]);
      expect(
        await (
          await database.getDb()
        )
          .collection("personalTaskHistory")
          .countDocuments({ taskId: f.task.id }),
      ).toBe(1);
    });
    it("keeps independent offline edits on two devices and resolves a real server conflict through the canonical outbox", async () => {
      const f = fixture(),
        push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        boot = createMongoSyncBootstrapService(database),
        raws = [new DatabaseSync(":memory:"), new DatabaseSync(":memory:")];
      try {
        const devices = raws.map((d) => new VisualTestDatabase(d));
        for (const d of devices) await runLocalMigrations(d);
        const service = (d: VisualTestDatabase) =>
          new MobileSyncService(
            d,
            {
              bootstrap: () =>
                boot.bootstrap(f.store, {
                  rawObservationDays: 90,
                  personalTasks: "true",
                }),
              push: (r) => push.push(r, "device", f.scope.ownerId),
              pull: (_, cursor) =>
                pull.pull(
                  f.scope.storeId,
                  { cursor, limit: 500, personalTasks: "true" },
                  f.scope.ownerId,
                ),
            },
            {
              deviceId: randomUUID(),
              appVersion: "test",
              personalTasks: true,
              copilotOwnerId: f.scope.ownerId,
            },
          );
        const a = new PersonalTaskRepository(devices[0]!, f.scope),
          b = new PersonalTaskRepository(devices[1]!, f.scope),
          ctx = () => ({
            deviceId: randomUUID(),
            commandId: randomUUID(),
            now: "2026-11-14T09:00:00.000Z",
            canWrite: () => true,
          }),
          fields = {
            text: f.task.text,
            date: f.task.date,
            time: f.task.time,
            status: f.task.status,
          };
        await a.save(f.task.id, fields, null, ctx());
        expect(await service(devices[0]!).sync(f.scope.storeId)).toMatchObject({
          pushed: 1,
          failed: 0,
        });
        await service(devices[1]!).sync(f.scope.storeId);
        expect((await b.get(f.task.id))?.entity.version).toBe(1);
        await a.save(f.task.id, { ...fields, text: "Depuis iPhone" }, 1, ctx());
        await b.save(
          f.task.id,
          { ...fields, text: "Depuis simulateur" },
          1,
          ctx(),
        );
        await service(devices[0]!).sync(f.scope.storeId);
        expect(await service(devices[1]!).sync(f.scope.storeId)).toMatchObject({
          conflicts: 1,
        });
        expect((await b.get(f.task.id))?.entity.text).toBe("Depuis simulateur");
        const review = await b.review(f.task.id);
        expect(review.ready).toBe(true);
        expect(review.remote?.text).toBe("Depuis iPhone");
        await b.resolve(f.task.id, true, review.token, ctx());
        expect(await service(devices[1]!).sync(f.scope.storeId)).toMatchObject({
          pushed: 1,
          conflicts: 0,
          failed: 0,
        });
        await service(devices[0]!).sync(f.scope.storeId);
        expect((await a.get(f.task.id))?.entity).toMatchObject({
          version: 3,
          text: "Depuis simulateur",
        });
      } finally {
        for (const d of raws) d.close();
      }
    });
    it("rejects immutable identity changes and stale versions without changing the retained record", async () => {
      const f = fixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(f.task), "create", f.scope.ownerId);
      const next = { ...f.task, version: 2, text: "Nouveau texte" };
      expect(
        (await push.push(request(next), "edit", f.scope.ownerId)).results[0]
          ?.status,
      ).toBe("APPLIED");
      const conflict = await push.push(
        request({ ...next, text: "Concurrent" }),
        "stale",
        f.scope.ownerId,
      );
      expect(conflict.results[0]?.status).toBe("CONFLICT");
      expect(conflict.results[0]?.remoteEntity).toMatchObject({
        text: "Nouveau texte",
        version: 2,
      });
      expect(
        (
          await push.push(
            request({
              ...next,
              version: 3,
              createdAt: "2026-11-13T08:00:00.000Z",
            }),
            "identity",
            f.scope.ownerId,
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      const foreign = request({ ...f.task, ownerId: randomUUID() });
      expect(
        (await push.push(foreign, "foreign", f.scope.ownerId)).results[0]
          ?.status,
      ).toBe("REJECTED");
    });
  },
);
