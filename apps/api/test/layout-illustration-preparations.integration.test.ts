import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Document } from "mongodb";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { readCopilotHistory } from "../src/copilot/history";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
  copilotHistoryQuerySchema,
} from "@fl-copilot/sync-contracts";
import { illustrationPreparationFixture } from "../../../scripts/test-layout-illustration-preparations";
import { AllocationSqliteAdapter } from "../../../scripts/test-physical-allocation-sqlite";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { applyBootstrap } from "../../mobile/src/sync/apply-bootstrap";
import { LayoutIllustrationRepository } from "../../mobile/src/copilot/layout-illustration-repository";
import { illustrationDigest } from "../../../scripts/test-layout-illustration-preparations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private local-first illustration preparations",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_illustration_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
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
      const f = await illustrationPreparationFixture(),
        db = await database.getDb(),
        put = async (
          name: string,
          id: string,
          value: Record<string, unknown>,
        ) =>
          db
            .collection<Document & { _id: string }>(name)
            .insertOne({ _id: id, ...value });
      await put("storeMemberships", randomUUID(), {
        storeId: f.scope.storeId,
        userId: f.scope.ownerId,
        active: true,
        role: "MANAGER",
      });
      await put("copilotConversations", f.conversation.id, f.conversation);
      for (const m of [f.user, f.assistant, f.card])
        await put("copilotMessages", m.id, m);
      await put("storeLayouts", f.scope.storeId, f.reference);
      for (const plan of [
        { ...f.first, content: f.reference.content },
        f.reference,
      ])
        await put("storeLayoutRevisions", plan.revisionId, {
          id: plan.revisionId,
          storeId: f.scope.storeId,
          plan,
          version: 1,
        });
      for (const p of f.sources.products) {
        const { id, ...rest } = p;
        await put("products", id, {
          ...rest,
          schemaVersion: 1,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          deletedAt: null,
        });
      }
      await put("commercialOfferChoices", f.choice.choice.id, {
        ...f.choice.choice,
        duplicateKey: randomUUID(),
      });
      const entity = await f.repo.prepare(f.card, f.ids),
        [outbox] = await new OutboxRepository(f.a).listPending(f.scope.storeId);
      const request = syncPushRequestSchema.parse({
        syncProtocolVersion: 1 as const,
        appVersion: "test",
        deviceId: f.ids.deviceId,
        storeId: f.scope.storeId,
        commands: [
          {
            commandId: outbox!.commandId,
            localSequence: outbox!.localSequence,
            type: outbox!.commandType,
            entityType: outbox!.entityType,
            entityId: outbox!.entityId,
            expectedRemoteVersion: null,
            createdAt: outbox!.createdAt,
            payload: outbox!.payload,
          },
        ],
      });
      return { ...f, dbMongo: db, entity, request };
    }
    const bootstrap = (ownerId: string, storeId: string) =>
      createMongoSyncBootstrapService(database).bootstrap(
        {
          storeId,
          userId: ownerId,
          role: "MANAGER",
          sessionId: randomUUID(),
          deviceId: randomUUID(),
          storeName: "Test",
        },
        bootstrapQuerySchema.parse({
          copilotHistory: "true",
          layoutIllustrations: "true",
          storeLayouts: "true",
          commercialChoices: "true",
        }),
        true,
        true,
      );
    it("syncs a real SQLite Outbox command once and restores the same preparation on a clean second device without generating an image", async () => {
      const f = await seed(),
        b = new DatabaseSync(":memory:"),
        a = new AllocationSqliteAdapter(b);
      try {
        const push = createMongoSyncPushService(database),
          first = await push.push(f.request, "first", f.scope.ownerId);
        expect(first.results[0]?.status).toBe("APPLIED");
        expect(
          (await push.push(f.request, "replay", f.scope.ownerId)).results[0]
            ?.status,
        ).toBe("ALREADY_APPLIED");
        expect(
          await f.dbMongo
            .collection<Document & { _id: string }>(
              "copilotLayoutIllustrations",
            )
            .countDocuments({ _id: f.entity.id }),
        ).toBe(1);
        const snapshot = await bootstrap(f.scope.ownerId, f.scope.storeId);
        expect(snapshot.entities.layoutIllustrations).toEqual([f.entity]);
        await runLocalMigrations(a);
        await applyBootstrap(a, f.scope.storeId, snapshot, f.scope.ownerId);
        const restored = await new LayoutIllustrationRepository(
          a,
          f.scope,
          illustrationDigest,
        ).find(f.card);
        expect(restored).toEqual({ entity: f.entity, syncState: "SYNCED" });
        expect(
          await new OutboxRepository(a).listPending(f.scope.storeId),
        ).toEqual([]);
        expect(
          await f.dbMongo
            .collection<Document & { _id: string }>("visualAssets")
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(0);
        expect(
          await f.dbMongo
            .collection<Document & { _id: string }>("localJobs")
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(0);
      } finally {
        f.db.close();
        b.close();
      }
    });
    it("checks owner, deleted parent and revoked membership before cached replay; changed fingerprints never overwrite a preparation", async () => {
      const f = await seed();
      try {
        const push = createMongoSyncPushService(database);
        await push.push(f.request, "first", f.scope.ownerId);
        const foreign = await push.push(f.request, "foreign", randomUUID());
        expect(foreign.results[0]?.status).toBe("REJECTED");
        expect(foreign.results[0]?.remoteEntity).toBeUndefined();
        const changed = structuredClone(f.request);
        changed.commands[0]!.commandId = randomUUID();
        changed.commands[0]!.payload = {
          ...f.entity,
          physicalHash: `sha256:${"a".repeat(64)}`,
        };
        expect(
          (await push.push(changed, "changed", f.scope.ownerId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        await f.dbMongo
          .collection<Document & { _id: string }>("copilotConversations")
          .updateOne(
            { _id: f.conversation.id },
            { $set: { deletedMessageIds: [f.user.id] } },
          );
        expect(
          (await push.push(f.request, "deleted", f.scope.ownerId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        await f.dbMongo
          .collection<Document & { _id: string }>("copilotConversations")
          .updateOne(
            { _id: f.conversation.id },
            { $unset: { deletedMessageIds: 1 } },
          );
        await f.dbMongo
          .collection<Document & { _id: string }>("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.ownerId },
            { $set: { active: false } },
          );
        expect(
          (await push.push(f.request, "revoked", f.scope.ownerId)).results[0]
            ?.status,
        ).toBe("REJECTED");
        expect(
          await f.dbMongo
            .collection<Document & { _id: string }>(
              "copilotLayoutIllustrations",
            )
            .countDocuments({ _id: f.entity.id }),
        ).toBe(1);
      } finally {
        f.db.close();
      }
    });
    it("omits preparations for an older client and a foreign owner while preserving its incremental cursor", async () => {
      const f = await seed();
      try {
        await createMongoSyncPushService(database).push(
          f.request,
          "first",
          f.scope.ownerId,
        );
        const old = await createMongoSyncBootstrapService(database).bootstrap(
          {
            storeId: f.scope.storeId,
            userId: f.scope.ownerId,
            role: "MANAGER",
            sessionId: randomUUID(),
            deviceId: randomUUID(),
            storeName: "Test",
          },
          bootstrapQuerySchema.parse({ copilotHistory: "true" }),
        );
        expect(old.entities.layoutIllustrations).toBeUndefined();
        const original = await createMongoSyncPullService(database).pull(
          f.scope.storeId,
          syncPullQuerySchema.parse({ copilotHistory: "true" }),
          f.scope.ownerId,
        );
        expect(
          original.changes.some(
            (c) => c.entityType === "copilot_layout_illustration",
          ),
        ).toBe(false);
        const foreign = await bootstrap(randomUUID(), f.scope.storeId);
        expect(foreign.entities.layoutIllustrations).toEqual([]);
      } finally {
        f.db.close();
      }
    });
    it("restores more than one bounded page before marking adoption, then retains all exact immutable identities", async () => {
      const f = await seed(),
        b = new DatabaseSync(":memory:"),
        a = new AllocationSqliteAdapter(b);
      try {
        await createMongoSyncPushService(database).push(
          f.request,
          "first",
          f.scope.ownerId,
        );
        await f.dbMongo
          .collection<Document & { _id: string }>("copilotLayoutIllustrations")
          .insertMany(
            Array.from({ length: 125 }, (_, i) => {
              const id = randomUUID();
              return {
                ...f.entity,
                id,
                _id: id,
                createdAt: new Date(
                  Date.parse(f.entity.createdAt) + i + 1,
                ).toISOString(),
              };
            }),
          );
        await runLocalMigrations(a);
        let pages = 0;
        const sync = new MobileSyncService(
          a,
          {
            bootstrap: (storeId) => bootstrap(f.scope.ownerId, storeId),
            illustrationHistoryPage: async (storeId, before) => {
              pages++;
              return readCopilotHistory(
                f.dbMongo,
                storeId,
                f.scope.ownerId,
                copilotHistoryQuerySchema.parse({
                  recordType: "LAYOUT_ILLUSTRATIONS",
                  beforeId: before?.id,
                  beforeCreatedAt: before?.createdAt,
                }),
              );
            },
            push: (input) =>
              createMongoSyncPushService(database).push(
                input,
                "b",
                f.scope.ownerId,
              ),
            pull: (storeId, cursor) =>
              createMongoSyncPullService(database).pull(
                storeId,
                syncPullQuerySchema.parse({
                  cursor,
                  copilotHistory: "true",
                  layoutIllustrations: "true",
                }),
                f.scope.ownerId,
              ),
          },
          {
            appVersion: "test",
            deviceId: randomUUID(),
            copilotOwnerId: f.scope.ownerId,
            copilotHistory: true,
            layoutIllustrations: true,
            maxRetries: 0,
          },
        );
        await sync.sync(f.scope.storeId);
        expect(pages).toBe(3);
        expect(
          b
            .prepare("SELECT COUNT(*) n FROM copilot_layout_illustrations")
            .get()!.n,
        ).toBe(126);
        expect(
          await a.getFirstAsync(
            "SELECT value FROM app_metadata WHERE key=?",
            `layout-illustrations:${f.scope.storeId}:${f.scope.ownerId}`,
          ),
        ).toEqual({ value: "1" });
        expect(
          await new OutboxRepository(a).listPending(f.scope.storeId),
        ).toEqual([]);
      } finally {
        f.db.close();
        b.close();
      }
    });
  },
);
