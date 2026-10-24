import { receiptReviewDigest } from "../../../scripts/test-receipt-publication-sqlite";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
import { CopilotConversationRepository } from "../../mobile/src/copilot/conversation-repository";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { runMongoMigrations } from "../src/database/migrations";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  applyKnowledge,
  type KnowledgeDocument,
} from "../src/copilot/knowledge-store";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import { readKnowledge } from "../src/copilot/knowledge-store";
import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CopilotKnowledgeRepository } from "../../mobile/src/copilot/knowledge-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import type { CopilotKnowledge } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "Confirmed private operating practices",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db(
        `fl_knowledge_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    it.each(["KEEP_LOCAL", "ADOPT_REMOTE"] as const)(
      "resolves a complete private group and restores the chosen practice on another device (%s)",
      async (decision) => {
        const scope = { storeId: randomUUID(), ownerId: randomUUID() },
          deviceId = randomUUID(),
          a = new MercalysTestDatabase(),
          b = new MercalysTestDatabase(),
          c = new MercalysTestDatabase(),
          service = {
            getDb: async () => db,
            checkHealth: async () => "connected" as const,
            close: async () => {},
          },
          push = createMongoSyncPushService(service),
          pull = createMongoSyncPullService(service),
          boot = createMongoSyncBootstrapService(service);
        const authority = {
          ...scope,
          userId: scope.ownerId,
          sessionId: randomUUID(),
          deviceId,
          storeName: "Pilote",
          role: "MANAGER" as const,
        };
        const transport = {
          push: (r: SyncPushRequest) =>
            push.push(r, randomUUID(), scope.ownerId),
          pull: (storeId: string, cursor: string) =>
            pull.pull(
              storeId,
              syncPullQuerySchema.parse({
                cursor,
                copilotHistory: "true",
                copilotKnowledge: "true",
              }),
              scope.ownerId,
            ),
          bootstrap: () =>
            boot.bootstrap(
              authority,
              bootstrapQuerySchema.parse({
                copilotHistory: "true",
                copilotKnowledge: "true",
              }),
            ),
        };
        const sync = (device: MercalysTestDatabase) =>
          new MobileSyncService(device, transport, {
            appVersion: "test",
            deviceId,
            copilotHistory: true,
            copilotKnowledge: true,
            copilotOwnerId: scope.ownerId,
          }).sync(scope.storeId);
        try {
          for (const device of [a, b, c]) await runLocalMigrations(device);
          const repoA = new CopilotKnowledgeRepository(
              a,
              scope,
              receiptReviewDigest,
            ),
            repoB = new CopilotKnowledgeRepository(
              b,
              scope,
              receiptReviewDigest,
            ),
            initial: CopilotKnowledge = {
              id: randomUUID(),
              ...scope,
              scope: "USER_STORE",
              kind: "OPERATING_PRACTICE",
              statement: "Pratique initiale",
              status: "ACTIVE",
              sourceMessageId: null,
              confirmedBy: scope.ownerId,
              version: 1,
              createdAt: "2026-10-15T12:00:00.000Z",
              updatedAt: "2026-10-15T12:00:00.000Z",
            };
          await repoA.save(initial, { deviceId, commandId: randomUUID() });
          await sync(a);
          await sync(b);
          const remote = {
              ...initial,
              version: 2,
              statement: "Pratique de l’appareil A",
            },
            local = {
              ...initial,
              version: 2,
              statement: "Pratique de l’appareil B",
            };
          await repoA.save(remote, { deviceId, commandId: randomUUID() });
          await sync(a);
          await repoB.save(local, { deviceId, commandId: randomUUID() });
          const original = (
            await new OutboxRepository(b).listPending(scope.storeId)
          ).find((packet) => packet.entityType === "copilot_knowledge")!;
          await sync(b);
          const queued = await new OutboxRepository(b).enqueue({
            ...original,
            commandId: randomUUID(),
          });
          const collision = await push.push(
            syncPushRequestSchema.parse({
              syncProtocolVersion: 1,
              appVersion: "test",
              deviceId,
              storeId: scope.storeId,
              commands: [
                {
                  commandId: queued.commandId,
                  localSequence: queued.localSequence,
                  type: queued.commandType,
                  entityType: queued.entityType,
                  entityId: queued.entityId,
                  expectedRemoteVersion: queued.expectedRemoteVersion,
                  createdAt: queued.createdAt,
                  payload: queued.payload,
                },
              ],
            }),
            randomUUID(),
            scope.ownerId,
          );
          expect(collision.results[0]).toMatchObject({
            status: "CONFLICT",
            remoteVersion: 2,
          });
          await new ConflictRepository(b).recordPushConflict(
            queued,
            collision.results[0]!,
          );
          await b.runAsync(
            "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
            queued.commandId,
          );
          const review = await repoB.review(initial.id);
          expect(review.group.conflicts).toHaveLength(2);
          expect(review.group.remote).toEqual(remote);
          expect(review.ready).toBe(true);
          const ctx = {
            ...scope,
            deviceId,
            commandId: randomUUID(),
            reviewCaptureId: randomUUID(),
            reviewHash: review.hash,
            canResolve: () => true,
          };
          await repoB.resolve(initial.id, decision === "KEEP_LOCAL", ctx);
          await sync(b);
          await sync(c);
          const restored = (
            await new CopilotKnowledgeRepository(c, scope).list()
          )[0]!;
          expect(restored.entity).toMatchObject({
            id: initial.id,
            ownerId: scope.ownerId,
            storeId: scope.storeId,
            version: decision === "KEEP_LOCAL" ? 3 : 2,
            statement:
              decision === "KEEP_LOCAL" ? local.statement : remote.statement,
          });
          expect(restored.syncState).toBe("SYNCED");
          const capture = await new ConflictRepository(b).getById(
            ctx.reviewCaptureId,
          );
          expect(capture?.remotePayload).toEqual(remote);
          expect(capture?.status).toBe(
            decision === "KEEP_LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          );
          expect(
            await new ConflictRepository(b).listOpenForEntity(
              scope.storeId,
              "copilot_knowledge",
              initial.id,
            ),
          ).toHaveLength(0);
          const histories = await db
            .collection("copilotKnowledgeHistory")
            .countDocuments({ knowledgeId: initial.id });
          expect(histories).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
          await sync(b);
          expect(
            await db
              .collection("copilotKnowledgeHistory")
              .countDocuments({ knowledgeId: initial.id }),
          ).toBe(histories);
          expect(
            await db
              .collection<KnowledgeDocument>("copilotKnowledge")
              .countDocuments({ _id: initial.id }),
          ).toBe(1);
        } finally {
          a.db.close();
          b.db.close();
          c.db.close();
        }
      },
    );
    it("syncs once, restores on another device, isolates users/old clients, resolves concurrent edits and stops using forgotten knowledge", async () => {
      const storeId = randomUUID(),
        ownerId = randomUUID(),
        deviceId = randomUUID(),
        now = "2026-10-15T12:00:00.000Z",
        a = new MercalysTestDatabase(),
        b = new MercalysTestDatabase();
      const service = {
        getDb: async () => db,
        checkHealth: async () => "connected" as const,
        close: async () => {},
      };
      const push = createMongoSyncPushService(service),
        pull = createMongoSyncPullService(service),
        boot = createMongoSyncBootstrapService(service);
      const authority = {
        storeId,
        userId: ownerId,
        sessionId: randomUUID(),
        deviceId,
        storeName: "Pilote",
        role: "MANAGER" as const,
      };
      const scope = { storeId, ownerId };
      const query = bootstrapQuerySchema.parse({
        copilotHistory: "true",
        copilotKnowledge: "true",
      });
      const transport = {
        push: (r: SyncPushRequest) => push.push(r, randomUUID(), ownerId),
        pull: (id: string, cursor: string) =>
          pull.pull(
            id,
            syncPullQuerySchema.parse({
              cursor,
              copilotHistory: "true",
              copilotKnowledge: "true",
            }),
            ownerId,
          ),
        bootstrap: () => boot.bootstrap(authority, query),
      };
      const sync = (device: MercalysTestDatabase) =>
        new MobileSyncService(device, transport, {
          appVersion: "test",
          deviceId,
          copilotHistory: true,
          copilotKnowledge: true,
          copilotOwnerId: ownerId,
        });
      try {
        await runLocalMigrations(a);
        await runLocalMigrations(b);
        const repo = new CopilotKnowledgeRepository(a, scope),
          other = new CopilotKnowledgeRepository(b, scope, receiptReviewDigest);
        const original = chatFixture(randomUUID);
        const conversationRepo = new CopilotConversationRepository(a, scope);
        await conversationRepo.save(
          { ...original.conversation, storeId, ownerId },
          { commandId: randomUUID(), deviceId },
        );
        const source = {
          ...original.message,
          storeId,
          ownerId,
          attachments: [],
          text: "La casse est scannée tous les jours mais saisie à la date de saisie quelques fois par semaine.",
        };
        await conversationRepo.append(source, {
          commandId: randomUUID(),
          deviceId,
          preserveDraft: true,
        });
        const entry: CopilotKnowledge = {
          id: randomUUID(),
          ...scope,
          scope: "USER_STORE",
          kind: "OPERATING_PRACTICE",
          statement:
            "La casse est comptabilisée à la date de saisie, plusieurs fois par semaine.",
          status: "ACTIVE",
          sourceMessageId: source.id,
          confirmedBy: ownerId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await repo.save(entry, { commandId: randomUUID(), deviceId });
        await sync(a).sync(storeId);
        expect((await repo.list())[0]?.syncState).toBe("SYNCED");
        expect((await readKnowledge(db, storeId, ownerId)).entries).toEqual([
          entry,
        ]);
        expect(
          (await readKnowledge(db, storeId, randomUUID())).entries,
        ).toEqual([]);
        expect(
          (await readKnowledge(db, randomUUID(), ownerId)).entries,
        ).toEqual([]);
        const oldClient = await pull.pull(
          storeId,
          syncPullQuerySchema.parse({ copilotHistory: "true" }),
          ownerId,
        );
        expect(
          oldClient.changes.some((c) => c.entityType === "copilot_knowledge"),
        ).toBe(false);
        expect(
          (
            await boot.bootstrap(
              authority,
              bootstrapQuerySchema.parse({ copilotHistory: "true" }),
            )
          ).entities.copilotKnowledge,
        ).toBeUndefined();
        await sync(b).sync(storeId);
        expect((await other.list())[0]?.entity).toEqual(entry);
        await repo.save(
          { ...entry, version: 2, statement: "Version appareil A" },
          { commandId: randomUUID(), deviceId },
        );
        await other.save(
          { ...entry, version: 2, statement: "Version appareil B" },
          { commandId: randomUUID(), deviceId },
        );
        await sync(a).sync(storeId);
        await sync(b).sync(storeId);
        expect((await other.list())[0]).toMatchObject({
          syncState: "CONFLICT",
          entity: { statement: "Version appareil B" },
          remote: { statement: "Version appareil A" },
        });
        const review = await other.review(entry.id);
        await other.resolve(entry.id, true, {
          ...scope,
          reviewHash: review.hash,
          reviewCaptureId: randomUUID(),
          canResolve: () => true,
          commandId: randomUUID(),
          deviceId,
        });
        await sync(b).sync(storeId);
        expect(
          (await readKnowledge(db, storeId, ownerId)).entries[0],
        ).toMatchObject({ version: 3, statement: "Version appareil B" });
        const current = (await other.list())[0]!.entity;
        await other.save(
          { ...current, version: 4, status: "FORGOTTEN", statement: "Oublié" },
          { commandId: randomUUID(), deviceId },
        );
        await sync(b).sync(storeId);
        expect((await readKnowledge(db, storeId, ownerId)).entries).toEqual([]);
        const second = (await boot.bootstrap(authority, query)).entities
          .copilotKnowledge;
        expect(second?.[0]).toMatchObject({
          status: "FORGOTTEN",
          statement: "Oublié",
        });
        expect(
          await db
            .collection("copilotKnowledgeHistory")
            .countDocuments({ knowledgeId: entry.id }),
        ).toBe(4);
      } finally {
        a.db.close();
        b.db.close();
      }
    });
    it("rejects a foreign owner before replay and rolls back partial writes", async () => {
      const storeId = randomUUID(),
        ownerId = randomUUID(),
        deviceId = randomUUID(),
        now = "2026-10-15T12:00:00.000Z";
      const payload: CopilotKnowledge = {
        id: randomUUID(),
        storeId,
        ownerId,
        scope: "USER_STORE",
        kind: "OPERATING_PRACTICE",
        statement: "Saisie différée",
        status: "ACTIVE",
        sourceMessageId: null,
        confirmedBy: ownerId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const service = {
        getDb: async () => db,
        checkHealth: async () => "connected" as const,
        close: async () => {},
      };
      const push = createMongoSyncPushService(service);
      const input: SyncPushRequest = {
        syncProtocolVersion: 1,
        appVersion: "test",
        deviceId,
        storeId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COPILOT_KNOWLEDGE_UPSERT",
            entityType: "copilot_knowledge",
            entityId: payload.id,
            createdAt: now,
            expectedRemoteVersion: null,
            payload,
          },
        ],
      };
      expect(
        (await push.push(input, randomUUID(), ownerId)).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (await push.push(input, randomUUID(), ownerId)).results[0]?.status,
      ).toBe("ALREADY_APPLIED");
      expect(
        (await push.push(input, randomUUID(), randomUUID())).results[0]?.status,
      ).toBe("REJECTED");
      const session = client.startSession();
      const id = randomUUID();
      try {
        await expect(
          session.withTransaction(async () => {
            const changes = createMongoSyncChangeService();
            changes.append = async () => {
              throw Error("ROLLBACK");
            };
            await applyKnowledge(
              { database: db, session },
              storeId,
              ownerId,
              {
                ...input.commands[0]!,
                commandId: randomUUID(),
                entityId: id,
                payload: { ...payload, id },
              },
              randomUUID(),
              changes,
            );
          }),
        ).rejects.toThrow("ROLLBACK");
        expect(
          await db
            .collection<{ _id: string }>("copilotKnowledge")
            .findOne({ _id: id }),
        ).toBeNull();
      } finally {
        await session.endSession();
      }
    });
  },
);
