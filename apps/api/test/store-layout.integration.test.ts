import { DatabaseSync } from "node:sqlite";
import { StoreLayoutRepository } from "../../mobile/src/store/layout-repository";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import type { OutboxDatabase } from "../../mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  layoutFixture,
  nextLayout,
  completeLayoutGeometry,
} from "../../../scripts/test-store-layout-fixtures";
import type { StoreLayout } from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  presentCopilotStoreLayout,
  readCopilotStoreLayoutSnapshot,
} from "../src/copilot/store-layout-tool";
import {
  addStoreLayoutMobile,
  duplicateStoreLayoutInventory,
  removeStoreLayoutInventory,
} from "@fl-copilot/commercial-core";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "store physical layout canonical sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_layout_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
      p: StoreLayout,
      expected: number | null = p.version === 1 ? null : p.version - 1,
    ): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      deviceId: randomUUID(),
      storeId: p.storeId,
      commands: [
        {
          commandId: randomUUID(),
          localSequence: 1,
          type: "STORE_LAYOUT_UPSERT",
          entityType: "store_layout",
          entityId: p.id,
          expectedRemoteVersion: expected,
          createdAt: p.updatedAt,
          payload: p,
        },
      ],
    });
    const service = (db: Adapter, deviceId: string, actorId: string) => {
      const push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        bootstrap = createMongoSyncBootstrapService(database);
      return new MobileSyncService(
        db,
        {
          push: (r) => push.push(r, "devices", actorId),
          pull: (storeId, cursor) =>
            pull.pull(storeId, {
              cursor,
              limit: 500,
              storeLayouts: "true",
            }),
          bootstrap: (storeId) =>
            bootstrap.bootstrap(
              {
                storeId,
                storeName: "Test",
                role: "MANAGER",
                deviceId,
                userId: actorId,
                sessionId: randomUUID(),
              },
              { rawObservationDays: 90, storeLayouts: "true" },
            ),
        },
        { appVersion: "test", deviceId, storeLayouts: true },
      );
    };

    it("keeps each revision once across retry, draft/reference/discard/restore and never touches business observations", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database),
        r = request(p),
        save = (v: StoreLayout) => push.push(request(v), "test", p.updatedBy);
      expect((await push.push(r, "save", p.updatedBy)).results[0]?.status).toBe(
        "APPLIED",
      );
      expect(
        (await push.push(r, "retry", p.updatedBy)).results[0]?.status,
      ).toBe("ALREADY_APPLIED");
      const id = randomUUID(),
        ref = nextLayout(p, {
          action: "ADOPT_REFERENCE",
          revisionId: id,
          referenceRevisionId: id,
        });
      expect((await save(ref)).results[0]?.status).toBe("APPLIED");
      const draft = nextLayout(ref, {
        content: {
          ...ref.content,
          provenance: { kind: "USER", reference: null },
        },
      });
      await save(draft);
      const discard = nextLayout(draft, { action: "DISCARD_DRAFT" });
      expect((await save(discard)).results[0]?.status).toBe("APPLIED");
      const restore = nextLayout(discard, {
        action: "RESTORE_AS_DRAFT",
        restoredFromRevisionId: p.revisionId,
        content: p.content,
      });
      expect((await save(restore)).results[0]?.status).toBe("APPLIED");
      const db = await database.getDb();
      expect(
        await db
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(5);
      expect(
        (await db.collection("storeLayouts").findOne({ storeId: p.storeId }))
          ?.referenceRevisionId,
      ).toBe(ref.revisionId);
      for (const c of [
        "salesObservations",
        "wasteObservations",
        "commercialWeekPlans",
        "products",
      ])
        expect(
          await db.collection(c).countDocuments({ storeId: p.storeId }),
        ).toBe(0);
    }, 60000);
    it("retains an impossible draft but rejects a forged adoption without publishing a reference or immutable revision", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database);
      p.content = completeLayoutGeometry();
      const tgs = p.content.furniture.filter((f) => f.kind === "TG");
      tgs[1]!.x = tgs[0]!.x;
      tgs[1]!.y = tgs[0]!.y;
      expect(
        (await push.push(request(p), "draft", p.updatedBy)).results[0]?.status,
      ).toBe("APPLIED");
      const revisionId = randomUUID(),
        adopted = nextLayout(p, {
          action: "ADOPT_REFERENCE",
          revisionId,
          referenceRevisionId: revisionId,
        }),
        r = request(adopted);
      const rejected = (await push.push(r, "bad-adoption", p.updatedBy))
        .results[0]!;
      expect(rejected.status).toBe("REJECTED");
      expect(rejected.error?.code).toBe("STORE_LAYOUT_GEOMETRY_BLOCKED");
      expect(
        (await push.push(r, "replay", p.updatedBy)).results[0]?.status,
      ).toBe("REJECTED");
      const db = await database.getDb();
      expect(
        await db
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(1);
      expect(
        (await db.collection("storeLayouts").findOne({ storeId: p.storeId }))
          ?.revisionId,
      ).toBe(p.revisionId);
      const pulled = await createMongoSyncPullService(database).pull(
        p.storeId,
        { limit: 500, storeLayouts: "true" },
      );
      expect(
        pulled.changes.filter((c) => c.entityType === "store_layout"),
      ).toHaveLength(1);
      expect(
        pulled.changes.some((c) => c.entityId === adopted.revisionId),
      ).toBe(false);
    }, 60000);
    it("reads the immutable adopted reference across conversations while a newer synchronized mobile draft stays explicitly separate", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(p), "initial", p.updatedBy);
      const revisionId = randomUUID(),
        reference = nextLayout(p, {
          action: "ADOPT_REFERENCE",
          revisionId,
          referenceRevisionId: revisionId,
        });
      await push.push(request(reference), "adopt", p.updatedBy);
      const draft = nextLayout(reference, {
        content: addStoreLayoutMobile(
          reference.content,
          randomUUID,
          "Mobile seulement en brouillon",
          reference.content.furniture[0]!.id,
        ),
      });
      await push.push(request(draft), "draft", p.updatedBy);
      const db = await database.getDb(),
        input = {
          view: "REFERENCE",
          expectedRevisionId: null,
          targetId: null,
          cursor: null,
          limit: 20,
        };
      const snapshot = await readCopilotStoreLayoutSnapshot(db, p.storeId);
      expect(snapshot.head?.revisionId).toBe(draft.revisionId);
      expect(snapshot.reference?.revisionId).toBe(reference.revisionId);
      const ref = presentCopilotStoreLayout(p.storeId, input, snapshot),
        pending = presentCopilotStoreLayout(
          p.storeId,
          { ...input, view: "DRAFT" },
          snapshot,
        );
      expect(ref.geometry?.counts.furniture).toBe(19);
      expect(pending.geometry?.counts.furniture).toBe(20);
      expect(JSON.stringify(ref)).not.toContain(
        "Mobile seulement en brouillon",
      );
      expect(
        presentCopilotStoreLayout(
          p.storeId,
          input,
          await readCopilotStoreLayoutSnapshot(db, p.storeId),
        ),
      ).toEqual(ref);
      expect(
        await db
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(3);
      expect(
        (await db.collection("storeLayouts").findOne({ storeId: p.storeId }))
          ?.revisionId,
      ).toBe(draft.revisionId);
    }, 60000);
    it("does not leak another store's target or seed furniture when a requested synchronized layout is absent", async () => {
      const p = layoutFixture(),
        other = layoutFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(p), "store", p.updatedBy);
      await push.push(request(other), "other", other.updatedBy);
      const db = await database.getDb(),
        input = {
          view: "DRAFT",
          expectedRevisionId: null,
          targetId: other.content.furniture[0]!.id,
          cursor: null,
          limit: 20,
        };
      const scoped = presentCopilotStoreLayout(
        p.storeId,
        input,
        await readCopilotStoreLayoutSnapshot(db, p.storeId),
      );
      expect(scoped.status).toBe("TARGET_NOT_FOUND");
      expect(scoped.items).toEqual([]);
      expect(scoped.target).toBeNull();
      const absentId = randomUUID();
      expect(await readCopilotStoreLayoutSnapshot(db, absentId)).toEqual({
        head: null,
        reference: null,
      });
      expect(
        await db
          .collection("storeLayouts")
          .countDocuments({ storeId: absentId }),
      ).toBe(0);
      expect(
        await db
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: absentId }),
      ).toBe(0);
    }, 60000);
    it("compares two device writes instead of overwriting, then accepts a deliberate rebased draft with both histories intact", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(p), "first", p.updatedBy);
      const concurrent = {
          ...p,
          revisionId: randomUUID(),
          content: {
            ...p.content,
            provenance: { kind: "USER" as const, reference: null },
          },
        },
        r = request(concurrent);
      const conflict = (await push.push(r, "other", p.updatedBy)).results[0]!;
      expect(conflict.status).toBe("CONFLICT");
      expect(conflict.remoteEntity).toEqual(p);
      expect(
        (await push.push(r, "replay-conflict", p.updatedBy)).results[0]?.status,
      ).toBe("CONFLICT");
      expect(
        (
          await push.push(
            request(nextLayout(p, { content: concurrent.content })),
            "chosen",
            p.updatedBy,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await (
          await database.getDb()
        )
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(2);
    }, 60000);
    it("rejects foreign store/actor, missing authentication, changed review content, forged pointers and cross-store restoration", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database),
        bad = request(p);
      bad.storeId = randomUUID();
      expect(
        (await push.push(bad, "foreign", p.updatedBy)).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        (await push.push(request(p), "actor", randomUUID())).results[0]?.status,
      ).toBe("REJECTED");
      expect((await push.push(request(p), "no-auth")).results[0]?.status).toBe(
        "REJECTED",
      );
      await push.push(request(p), "save", p.updatedBy);
      const n = nextLayout(p);
      n.referenceRevisionId = randomUUID();
      expect(
        (await push.push(request(n), "pointer", p.updatedBy)).results[0]
          ?.status,
      ).toBe("REJECTED");
      const id = randomUUID(),
        invalidReview = nextLayout(p, {
          action: "ADOPT_REFERENCE",
          revisionId: id,
          referenceRevisionId: id,
          content: {
            ...p.content,
            provenance: { kind: "USER", reference: null },
          },
        });
      expect(
        (await push.push(request(invalidReview), "review", p.updatedBy))
          .results[0]?.status,
      ).toBe("REJECTED");
      const foreign = layoutFixture();
      await push.push(request(foreign), "other", foreign.updatedBy);
      expect(
        (
          await push.push(
            request(
              nextLayout(p, {
                action: "RESTORE_AS_DRAFT",
                restoredFromRevisionId: foreign.revisionId,
                content: foreign.content,
              }),
            ),
            "restore",
            p.updatedBy,
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      expect(
        await (
          await database.getDb()
        )
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(1);
    }, 60000);
    it("restores full store history for capable clients, gates legacy pulls/bootstrap, isolates stores and supplies immutable old snapshots", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(p), "save", p.updatedBy);
      const n = nextLayout(p);
      await push.push(request(n), "edit", p.updatedBy);
      const pull = createMongoSyncPullService(database),
        old = await pull.pull(p.storeId, { limit: 500 });
      expect(old.changes).toEqual([]);
      const page = await pull.pull(p.storeId, {
        limit: 500,
        storeLayouts: "true",
      });
      expect(page.changes).toHaveLength(4);
      expect(
        page.changes
          .filter((c) => c.entityType === "store_layout_revision")
          .map((c) => c.entity),
      ).toEqual(
        expect.arrayContaining([
          { id: p.revisionId, storeId: p.storeId, plan: p, version: 1 },
          { id: n.revisionId, storeId: p.storeId, plan: n, version: 1 },
        ]),
      );
      expect(
        (await pull.pull(randomUUID(), { limit: 500, storeLayouts: "true" }))
          .changes,
      ).toEqual([]);
      const boot = createMongoSyncBootstrapService(database),
        ctx = {
          storeId: p.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: p.updatedBy,
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        };
      expect(
        (await boot.bootstrap(ctx, { rawObservationDays: 90 })).entities
          .storeLayouts,
      ).toBeUndefined();
      const snapshot = await boot.bootstrap(ctx, {
        rawObservationDays: 90,
        storeLayouts: "true",
      });
      expect(snapshot.entities.storeLayouts).toEqual([n]);
      expect(snapshot.entities.storeLayoutRevisions).toHaveLength(2);
    }, 60000);
    it("serializes simultaneous edits without silently choosing a winner for both writers", async () => {
      const p = layoutFixture(),
        push = createMongoSyncPushService(database);
      await push.push(request(p), "base", p.updatedBy);
      const a = nextLayout(p),
        b = nextLayout(p, {
          content: {
            ...p.content,
            provenance: { kind: "USER", reference: null },
          },
        });
      const results = await Promise.all([
        push.push(request(a), "a", p.updatedBy),
        push.push(request(b), "b", p.updatedBy),
      ]);
      expect(results.map((r) => r.results[0]?.status).sort()).toEqual([
        "APPLIED",
        "CONFLICT",
      ]);
      expect(
        await (
          await database.getDb()
        )
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: p.storeId }),
      ).toBe(2);
    }, 60000);

    it("synchronizes explicit fixed inventory edits and restores every old surface and detached mobile on a fresh device", async () => {
      const p = layoutFixture(),
        a = new Adapter(new DatabaseSync(":memory:")),
        b = new Adapter(new DatabaseSync(":memory:")),
        fresh = new Adapter(new DatabaseSync(":memory:"));
      try {
        for (const db of [a, b, fresh]) await runLocalMigrations(db);
        const repoA = new StoreLayoutRepository(
            a,
            randomUUID,
            () => p.updatedAt,
          ),
          repoB = new StoreLayoutRepository(b, randomUUID, () => p.updatedAt),
          repoFresh = new StoreLayoutRepository(
            fresh,
            randomUUID,
            () => p.updatedAt,
          );
        const ctx = {
          commandId: randomUUID(),
          deviceId: randomUUID(),
          actorId: p.updatedBy,
          canWrite: true as const,
        };
        const syncA = service(a, ctx.deviceId, p.updatedBy),
          syncB = service(b, randomUUID(), p.updatedBy),
          syncFresh = service(fresh, randomUUID(), p.updatedBy);
        const content = addStoreLayoutMobile(
          p.content,
          randomUUID,
          "Mobile conservé",
          p.content.furniture[0]!.id,
        );
        const first = await repoA.save(
          {
            storeId: p.storeId,
            expectedRevisionId: null,
            action: "SAVE_DRAFT",
            content,
          },
          ctx,
        );
        await syncA.sync(p.storeId);
        await syncB.sync(p.storeId);
        expect((await repoB.get(p.storeId))?.entity).toEqual(first);
        const island = first.content.assemblies[0]!;
        const copy = duplicateStoreLayoutInventory(
          first.content,
          { kind: "ASSEMBLY", id: island.id },
          { label: "Copie déclarée", copyDimensions: false },
          randomUUID,
        );
        const copied = await repoA.save(
          {
            storeId: p.storeId,
            expectedRevisionId: first.revisionId,
            action: "SAVE_DRAFT",
            content: copy.content,
          },
          { ...ctx, commandId: randomUUID() },
        );
        await syncA.sync(p.storeId);
        await syncA.sync(p.storeId);
        await syncB.sync(p.storeId);
        expect((await repoB.get(p.storeId))?.entity).toEqual(copied);
        const removed = await repoA.save(
          {
            storeId: p.storeId,
            expectedRevisionId: copied.revisionId,
            action: "SAVE_DRAFT",
            content: removeStoreLayoutInventory(copied.content, {
              kind: "ASSEMBLY",
              id: island.id,
            }),
          },
          { ...ctx, commandId: randomUUID() },
        );
        await syncA.sync(p.storeId);
        await syncB.sync(p.storeId);
        await syncFresh.sync(p.storeId);
        for (const repo of [repoB, repoFresh]) {
          expect((await repo.get(p.storeId))?.entity).toEqual(removed);
          expect(
            (await repo.getRevision(p.storeId, first.revisionId))?.content,
          ).toEqual(first.content);
          expect(
            (await repo.getRevision(p.storeId, copied.revisionId))?.content
              .surfaces,
          ).toEqual(copied.content.surfaces);
          expect(
            (await repo.get(p.storeId))?.entity.content.furniture.find(
              (f) => f.kind === "MOBILE",
            )?.hostId,
          ).toBeNull();
        }
        const db = await database.getDb();
        expect(
          await db
            .collection("storeLayoutRevisions")
            .countDocuments({ storeId: p.storeId }),
        ).toBe(3);
        for (const collection of [
          "salesObservations",
          "wasteObservations",
          "products",
          "commercialWeekPlans",
        ])
          expect(
            await db
              .collection(collection)
              .countDocuments({ storeId: p.storeId }),
          ).toBe(0);
      } finally {
        a.db.close();
        b.db.close();
        fresh.db.close();
      }
    }, 60000);

    it("recovers two SQLite devices through Mongo, retains the rejected intention and synchronizes its explicit rebased draft", async () => {
      const p = layoutFixture(),
        a = new Adapter(new DatabaseSync(":memory:")),
        b = new Adapter(new DatabaseSync(":memory:"));
      try {
        await runLocalMigrations(a);
        await runLocalMigrations(b);
        const repoA = new StoreLayoutRepository(
            a,
            randomUUID,
            () => p.updatedAt,
          ),
          repoB = new StoreLayoutRepository(b, randomUUID, () => p.updatedAt);
        const ctxA = {
            commandId: randomUUID(),
            actorId: p.updatedBy,
            deviceId: randomUUID(),
            canWrite: true as const,
          },
          ctxB = { ...ctxA, commandId: randomUUID(), deviceId: randomUUID() };
        const syncA = service(a, ctxA.deviceId, p.updatedBy),
          syncB = service(b, ctxB.deviceId, p.updatedBy),
          first = await repoA.save(
            {
              storeId: p.storeId,
              expectedRevisionId: null,
              action: "SAVE_DRAFT",
              content: p.content,
            },
            ctxA,
          );
        await syncA.sync(p.storeId);
        await syncB.sync(p.storeId);
        expect((await repoB.get(p.storeId))?.entity).toEqual(first);
        const change = {
          storeId: p.storeId,
          expectedRevisionId: first.revisionId,
          action: "SAVE_DRAFT" as const,
          content: {
            ...p.content,
            provenance: { kind: "USER" as const, reference: null },
          },
        };
        const accepted = await repoA.save(change, {
            ...ctxA,
            commandId: randomUUID(),
          }),
          rejected = await repoB.save(
            { ...change, content: p.content },
            { ...ctxB, commandId: randomUUID() },
          );
        await syncA.sync(p.storeId);
        expect((await syncB.sync(p.storeId)).conflicts).toBe(1);
        expect((await repoB.get(p.storeId))?.entity).toEqual(rejected);
        const conflict = (
          await new ConflictRepository(b).listOpen(p.storeId)
        )[0]!;
        await repoB.resolve(
          conflict.id,
          {
            storeId: p.storeId,
            useLocal: true,
            localRevisionId: rejected.revisionId,
            remoteRevisionId: accepted.revisionId,
          },
          { ...ctxB, commandId: randomUUID() },
        );
        expect((await syncB.sync(p.storeId)).pushed).toBe(1);
        await syncA.sync(p.storeId);
        expect((await repoA.get(p.storeId))?.entity).toEqual(
          (await repoB.get(p.storeId))?.entity,
        );
        expect(
          (await repoB.history(p.storeId)).some(
            (r) => r.revision.id === rejected.revisionId && !r.synced,
          ),
        ).toBe(true);
        expect(
          await (
            await database.getDb()
          )
            .collection("storeLayoutRevisions")
            .countDocuments({ storeId: p.storeId }),
        ).toBe(3);
      } finally {
        a.db.close();
        b.db.close();
      }
    }, 60000);
  },
);
