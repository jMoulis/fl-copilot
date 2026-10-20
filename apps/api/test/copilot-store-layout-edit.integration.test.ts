import { DatabaseSync } from "node:sqlite";
import { AllocationSqliteAdapter } from "../../../scripts/test-physical-allocation-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { StoreLayoutRepository } from "../../mobile/src/store/layout-repository";
import { CopilotStoreLayoutEditController } from "../../mobile/src/copilot/store-layout-edit-controller";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import type { DatabaseService } from "../src/database/types";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { runMongoMigrations } from "../src/database/migrations";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { readCopilotLayoutEditProposal } from "@fl-copilot/domain";
import { readCopilotStoreLayoutSnapshot } from "../src/copilot/store-layout-tool";
import { presentStoreLayoutEdit } from "../src/copilot/store-layout-edit-tool";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { layoutFixture } from "../../../scripts/test-store-layout-fixtures";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private physical draft proposals",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_layout_chat_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      );
      await runMongoMigrations(db);
    }, 60000);
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    }, 60000);
    async function setup(
      forged = false,
      action: "ADD_MOBILE" | "COPY_ASSEMBLY" | "REMOVE_ASSEMBLY" = "ADD_MOBILE",
    ) {
      const chat = chatFixture(randomUUID),
        head = layoutFixture(chat.storeId, chat.ownerId);
      chat.message.attachments = [];
      chat.message.text =
        action === "COPY_ASSEMBLY"
          ? "Copie cet îlot sans reprendre ses mesures."
          : action === "REMOVE_ASSEMBLY"
            ? "Retire cet îlot du brouillon."
            : "Ajoute un mobile de vente sous cet élément, nommé Mobile pommes.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .insertOne({ _id: head.id, ...head });
      const input =
        action === "COPY_ASSEMBLY"
          ? {
              action,
              expectedRevisionId: head.revisionId,
              label: "Îlot copie",
              targetId: head.content.assemblies[0]!.id,
              copyDimensions: false,
            }
          : action === "REMOVE_ASSEMBLY"
            ? {
                action,
                expectedRevisionId: head.revisionId,
                targetId: head.content.assemblies[0]!.id,
              }
            : {
                action: "ADD_MOBILE",
                expectedRevisionId: head.revisionId,
                label: "Mobile pommes",
                hostId: head.content.furniture[0]!.id,
              };
      const preview = presentStoreLayoutEdit(
        chat.storeId,
        input,
        await readCopilotStoreLayoutSnapshot(db, chat.storeId),
      );
      if (forged) preview.basis!.storeId = randomUUID();
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Ajout préparé, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-layout",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        layoutEditPreviews: [preview],
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: chat.storeId,
          ownerId: chat.ownerId,
          canRespond: true,
        }),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: chat.storeId,
              evaluatedAt: chat.message.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      return {
        chat,
        head,
        preview,
        generate,
        dependencies,
        turn: {
          conversationId: chat.conversation.id,
          userMessageId: chat.message.id,
          replyId: randomUUID(),
        },
      };
    }
    it.each(["ADD_MOBILE", "COPY_ASSEMBLY", "REMOVE_ASSEMBLY"] as const)(
      "commits and synchronizes %s as one immutable review card, replays without any physical business write",
      async (action) => {
        const s = await setup(false, action),
          before = await db
            .collection("storeLayouts")
            .findOne({ _id: s.head.id } as Document);
        await runCopilotTurn(s.dependencies, s.turn);
        const rows = await db
          .collection("copilotMessages")
          .find({ conversationId: s.chat.conversation.id, role: "TOOL" })
          .toArray();
        expect(rows).toHaveLength(1);
        const { _id, ...raw } = rows[0]!;
        const p = readCopilotLayoutEditProposal(raw);
        expect(p.content.input.action).toBe(action);
        expect(p.content.created).toEqual(s.preview.created);
        expect(p.content.basis.revisionId).toBe(s.head.revisionId);
        expect(
          await db.collection("syncChanges").countDocuments({ entityId: _id }),
        ).toBe(1);
        expect(
          (await runCopilotTurn(s.dependencies, s.turn)).alreadyApplied,
        ).toBe(true);
        expect(s.generate).toHaveBeenCalledOnce();
        expect(
          await db
            .collection("storeLayouts")
            .findOne({ _id: s.head.id } as Document),
        ).toEqual(before);
        expect(
          await db
            .collection("storeLayoutRevisions")
            .countDocuments({ storeId: s.chat.storeId }),
        ).toBe(0);
      },
    );
    it("restores a private copy proposal from Mongo, confirms locally, synchronizes the same identities to another device and keeps the historical source", async () => {
      const s = await setup(false, "COPY_ASSEMBLY");
      const database: DatabaseService = {
        getDb: async () => db,
        checkHealth: async () => "connected",
        close: async () => {},
      };
      const push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        bootstrap = createMongoSyncBootstrapService(database);
      // Seed the canonical command path, rather than rely on the setup's read-only layout snapshot.
      await db
        .collection("storeLayouts")
        .deleteOne({ _id: s.head.id } as Document);
      const seed = await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: s.chat.deviceId,
          storeId: s.chat.storeId,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: "STORE_LAYOUT_UPSERT",
              entityType: "store_layout",
              entityId: s.head.id,
              expectedRemoteVersion: null,
              createdAt: s.head.updatedAt,
              payload: s.head,
            },
          ],
        },
        "seed",
        s.chat.ownerId,
      );
      expect(seed.results[0]?.status).toBe("APPLIED");
      await runCopilotTurn(s.dependencies, s.turn);
      const sqlA = new DatabaseSync(":memory:"),
        sqlB = new DatabaseSync(":memory:");
      const a = new AllocationSqliteAdapter(sqlA),
        b = new AllocationSqliteAdapter(sqlB);
      const service = (adapter: AllocationSqliteAdapter, deviceId: string) =>
        new MobileSyncService(
          adapter,
          {
            push: (r) => push.push(r, "device", s.chat.ownerId),
            pull: (storeId, cursor) =>
              pull.pull(
                storeId,
                {
                  cursor,
                  limit: 500,
                  storeLayouts: "true",
                  copilotHistory: "true",
                },
                s.chat.ownerId,
              ),
            bootstrap: (storeId) =>
              bootstrap.bootstrap(
                {
                  storeId,
                  storeName: "Test",
                  role: "MANAGER",
                  deviceId,
                  userId: s.chat.ownerId,
                  sessionId: randomUUID(),
                },
                {
                  rawObservationDays: 90,
                  storeLayouts: "true",
                  copilotHistory: "true",
                },
              ),
          },
          {
            appVersion: "test",
            deviceId,
            storeLayouts: true,
            copilotHistory: true,
            copilotOwnerId: s.chat.ownerId,
          },
        );
      try {
        await runLocalMigrations(a);
        await runLocalMigrations(b);
        const syncA = service(a, s.chat.deviceId),
          syncB = service(b, randomUUID());
        await syncA.sync(s.chat.storeId);
        const row = await a.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE conversation_id=? AND json_extract(payload_json,'$.role')='TOOL'",
          s.chat.conversation.id,
        );
        expect(row).not.toBeNull();
        const card = readCopilotLayoutEditProposal(
          JSON.parse(row!.payload_json),
        ).message;
        const controller = new CopilotStoreLayoutEditController(
          a,
          {
            storeId: s.chat.storeId,
            ownerId: s.chat.ownerId,
            deviceId: s.chat.deviceId,
            canManageStoreLayout: true,
          },
          randomUUID,
        );
        const opened = await controller.open(card);
        expect(opened.status).toBe("READY");
        expect(
          (await a.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
          ))!.n,
        ).toBe(0);
        await controller.confirm(card);
        await syncA.sync(s.chat.storeId);
        await syncA.sync(s.chat.storeId);
        await syncB.sync(s.chat.storeId);
        const headB = (await new StoreLayoutRepository(b, randomUUID).get(
          s.chat.storeId,
        ))!.entity;
        expect(headB.content).toEqual(opened.review!.after);
        expect(
          (await new StoreLayoutRepository(b, randomUUID).getRevision(
            s.chat.storeId,
            s.head.revisionId,
          ))!.content,
        ).toEqual(s.head.content);
        expect(headB.content.assemblies).toHaveLength(3);
        expect(headB.content.furniture).toHaveLength(27);
        expect((await controller.confirm(card)).status).toBe("COMPLETED");
        expect(
          (await a.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
          ))!.n,
        ).toBe(1);
        expect(
          (await a.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout' AND status='ACKNOWLEDGED'",
          ))!.n,
        ).toBe(1);
        expect(
          (await a.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout' AND status IN ('PENDING','SYNCING','FAILED','CONFLICT')",
          ))!.n,
        ).toBe(0);
        expect(
          await db
            .collection("storeLayoutRevisions")
            .countDocuments({ storeId: s.chat.storeId }),
        ).toBe(2);
        for (const name of [
          "products",
          "salesRecords",
          "wasteRecords",
          "commercialWeekPlans",
        ])
          expect(
            await db
              .collection(name)
              .countDocuments({ storeId: s.chat.storeId }),
          ).toBe(0);
      } finally {
        sqlA.close();
        sqlB.close();
      }
    }, 60000);
    it("rolls back both reply and card when the prepared physical source belongs to another store", async () => {
      const s = await setup(true);
      await expect(runCopilotTurn(s.dependencies, s.turn)).rejects.toThrow();
      expect(
        await db.collection("copilotMessages").countDocuments({
          conversationId: s.chat.conversation.id,
          role: { $in: ["ASSISTANT", "TOOL"] },
        }),
      ).toBe(0);
      expect(
        await db.collection("syncChanges").countDocuments({
          entityType: "copilot_message",
          storeId: s.chat.storeId,
        }),
      ).toBe(0);
    });
  },
);
