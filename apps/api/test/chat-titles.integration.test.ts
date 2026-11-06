import { vi } from "vitest";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { runCopilotTurn } from "../src/copilot/turn-service";
import {
  CopilotAiError,
  type CopilotAiProvider,
} from "../src/copilot/ai-provider";
import { MercalysTestDatabase } from "../../../scripts/test-mercalys-sync-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CopilotConversationRepository } from "../../mobile/src/copilot/conversation-repository";
import { CopilotLocalChatController } from "../../mobile/src/copilot/local-chat-controller";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  syncPullQuerySchema,
  bootstrapQuerySchema,
} from "@fl-copilot/sync-contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type {
  CopilotConversation,
  CopilotMessage,
  SyncPushRequest,
} from "@fl-copilot/sync-contracts";
import { copilotConversationSchema } from "@fl-copilot/domain";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import {
  updateGeneratedConversationTitle,
  serializeChat,
} from "../src/copilot/conversation-store";
import { appendCopilotResponse } from "../src/copilot/response-store";
import { readCopilotHistory, historyQuerySchema } from "../src/copilot/history";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "canonical conversation titles on disposable Mongo",
  () => {
    let database: DatabaseService, db: Db;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: "fl_titles_" + randomUUID().replaceAll("-", ""),
        }),
      );
      db = await database.getDb();
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await database?.close();
      }
    });
    async function fixture(initialTitle = "Nouvelle conversation") {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database);
      const authority = {
        storeId: f.storeId,
        ownerId: f.ownerId,
        canRespond: true,
      };
      async function save(
        value: CopilotConversation | CopilotMessage,
        titleIntent?: "MANUAL",
      ) {
        const message = "conversationId" in value;
        const packet: SyncPushRequest = {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId: f.storeId,
          deviceId: f.deviceId,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: message
                ? "COPILOT_MESSAGE_APPEND"
                : "COPILOT_CONVERSATION_UPSERT",
              entityType: message ? "copilot_message" : "copilot_conversation",
              entityId: value.id,
              expectedRemoteVersion:
                message || value.version === 1 ? null : value.version - 1,
              createdAt:
                "updatedAt" in value ? value.updatedAt : value.createdAt,
              payload: { ...value, ...(titleIntent ? { titleIntent } : {}) },
            },
          ],
        };
        const result = await push.push(packet, randomUUID(), f.ownerId);
        expect(result.results[0]?.status).toBe("APPLIED");
        return packet;
      }
      await save({ ...f.conversation, title: initialTitle });
      await save({ ...f.message, attachments: [] });
      const read = async () => {
        const row = await db
          .collection("copilotConversations")
          .findOne({ _id: f.conversation.id as never });
        return copilotConversationSchema.parse(
          serializeChat("copilot_conversation", row as never),
        );
      };
      const addReply = async () => {
        const reply: CopilotMessage = {
          ...f.message,
          id: randomUUID(),
          role: "ASSISTANT",
          text: "Réponse conservée",
          attachments: [],
          replyToMessageId: f.message.id,
        };
        const session = db.client.startSession();
        try {
          await session.withTransaction(() =>
            appendCopilotResponse(
              { database: db, session },
              authority,
              reply,
              createMongoSyncChangeService(),
            ),
          );
        } finally {
          await session.endSession();
        }
        return reply;
      };
      return {
        f,
        save,
        read,
        addReply,
        authority,
        authorize: async () => authority,
      };
    }
    it.each([null, "COPILOT_AI_TIMEOUT", "COPILOT_AI_OUTPUT_LIMIT"] as const)(
      "keeps the normal turn lease/replay and title after success or failure (%s)",
      async (failure) => {
        const f = await fixture();
        const generate = vi.fn<CopilotAiProvider["generate"]>(
          async (_request, schema) => {
            if (failure)
              throw new CopilotAiError(failure, true, "Suivi du rayon");
            return {
              output: schema.parse({
                language: "fr-FR",
                summary: "Salut !",
                narrative: "Salut !",
                facts: [],
                interpretation: [],
                recommendations: [],
                questions: [],
              }),
              metadata: {
                requestedModel: "light-test",
                resolvedModel: "light-test",
                responseId: "test-response",
                inputTokens: 10,
                outputTokens: 10,
              },
              titleProposal: "Suivi du rayon",
            };
          },
        );
        const titleTasks: Promise<unknown>[] = [];
        const dependencies = {
          onTitleReady: (proposal: {
            message: CopilotMessage;
            title: string;
            expectedTitle: string;
          }) => {
            titleTasks.push(
              updateGeneratedConversationTitle(
                db,
                f.authorize,
                proposal.message,
                proposal.title,
                proposal.expectedTitle,
              ),
            );
          },
          db,
          provider: {
            model: "light-test",
            generate: generate as CopilotAiProvider["generate"],
          },
          authorize: f.authorize,
          loadContext: async () =>
            detectCopilotConflicts({
              batch: scoreCopilotPriorities({
                storeId: f.f.storeId,
                evaluatedAt: f.f.message.createdAt,
                candidates: [],
              }),
              intents: [],
            }),
        };
        const input = {
          conversationId: f.f.conversation.id,
          userMessageId: f.f.message.id,
          replyId: randomUUID(),
        };
        const result = await runCopilotTurn(dependencies, input);
        expect(result.alreadyApplied).toBe(false);
        await Promise.all(titleTasks);
        expect(await f.read()).toMatchObject({
          title: "Suivi du rayon",
          version: 2,
        });
        expect((await runCopilotTurn(dependencies, input)).alreadyApplied).toBe(
          true,
        );
        expect(generate).toHaveBeenCalledTimes(1);
        expect(titleTasks).toHaveLength(1);
        expect(await f.read()).toMatchObject({
          title: "Suivi du rayon",
          version: 2,
        });
      },
    );
    it("synchronizes an offline manual rename over an intervening automatic title without a conflict", async () => {
      const f = await fixture(),
        native = new MercalysTestDatabase();
      try {
        await runLocalMigrations(native);
        const push = createMongoSyncPushService(database),
          pull = createMongoSyncPullService(database),
          boot = createMongoSyncBootstrapService(database);
        const deviceId = randomUUID(),
          scope = { storeId: f.f.storeId, ownerId: f.f.ownerId };
        const transport = {
          push: (packet: SyncPushRequest) =>
            push.push(packet, randomUUID(), f.f.ownerId),
          pull: (storeId: string, cursor: string) =>
            pull.pull(
              storeId,
              syncPullQuerySchema.parse({ cursor, copilotHistory: "true" }),
              f.f.ownerId,
              true,
            ),
          bootstrap: () =>
            boot.bootstrap(
              {
                ...scope,
                userId: f.f.ownerId,
                deviceId,
                storeName: "Test",
                role: "MANAGER",
                sessionId: randomUUID(),
              },
              bootstrapQuerySchema.parse({ copilotHistory: "true" }),
              true,
            ),
        };
        const sync = new MobileSyncService(native, transport, {
          deviceId,
          appVersion: "test",
          copilotHistory: true,
          copilotOwnerId: f.f.ownerId,
        });
        await sync.sync(f.f.storeId);
        const repo = new CopilotConversationRepository(native, scope);
        await new CopilotLocalChatController(
          repo,
          { ...scope, deviceId },
          randomUUID,
        ).rename(f.f.conversation.id, "Mon titre choisi hors ligne");
        const reply = await f.addReply();
        expect(
          await updateGeneratedConversationTitle(
            db,
            f.authorize,
            reply,
            "Titre automatique",
            "Nouvelle conversation",
          ),
        ).toBe(true);
        await sync.sync(f.f.storeId);
        expect(await repo.get(f.f.conversation.id)).toMatchObject({
          title: "Mon titre choisi hors ligne",
          version: 3,
        });
        expect(await f.read()).toEqual(await repo.get(f.f.conversation.id));
        expect(
          await native.getFirstAsync(
            "SELECT status FROM sync_outbox ORDER BY local_sequence DESC LIMIT 1",
          ),
        ).toMatchObject({ status: "ACKNOWLEDGED" });
        expect(
          await updateGeneratedConversationTitle(
            db,
            f.authorize,
            await f.addReply(),
            "Autre titre",
            "Mon titre choisi hors ligne",
          ),
        ).toBe(false);
      } finally {
        native.db.close();
      }
    });
    it("updates canonical title/history/change stream once and remains readable by legacy history clients", async () => {
      const f = await fixture(),
        reply = await f.addReply();
      expect(
        await updateGeneratedConversationTitle(
          db,
          f.authorize,
          reply,
          "Préparation des deux TG",
          "Nouvelle conversation",
        ),
      ).toBe(true);
      expect(await f.read()).toMatchObject({
        title: "Préparation des deux TG",
        version: 2,
      });
      expect(
        await db
          .collection("copilotConversationHistory")
          .findOne({ _id: reply.id as never }),
      ).toMatchObject({ titleOrigin: "AUTOMATIC", version: 2 });
      const before = await db
        .collection("syncChanges")
        .countDocuments({ storeId: f.f.storeId });
      expect(
        await updateGeneratedConversationTitle(
          db,
          f.authorize,
          reply,
          "Autre titre",
          "Préparation des deux TG",
        ),
      ).toBe(false);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ storeId: f.f.storeId }),
      ).toBe(before);
      const page = await readCopilotHistory(
        db,
        f.f.storeId,
        f.f.ownerId,
        historyQuerySchema.parse({ limit: 20 }),
        true,
        2,
      );
      expect(page.conversations).toContainEqual(await f.read());
      expect(JSON.stringify(page)).not.toContain("titleOrigin");
    });
    it("refreshes an automatic title on a later subject but locks an explicitly confirmed manual title even unchanged", async () => {
      const f = await fixture(),
        first = await f.addReply();
      await updateGeneratedConversationTitle(
        db,
        f.authorize,
        first,
        "Préparer les TG",
        "Nouvelle conversation",
      );
      const second = await f.addReply();
      expect(
        await updateGeneratedConversationTitle(
          db,
          f.authorize,
          second,
          "Analyse de la casse",
          "Préparer les TG",
        ),
      ).toBe(true);
      const current = await f.read();
      await f.save({ ...current, version: current.version + 1 }, "MANUAL");
      const third = await f.addReply();
      expect(
        await updateGeneratedConversationTitle(
          db,
          f.authorize,
          third,
          "Autre sujet",
          current.title,
        ),
      ).toBe(false);
      expect(await f.read()).toMatchObject({
        title: current.title,
        version: 4,
      });
    });
    it("never overwrites a pre-existing custom title or an old-client manual rename", async () => {
      const old = await fixture("Mon suivi personnel"),
        oldReply = await old.addReply();
      expect(
        await updateGeneratedConversationTitle(
          db,
          old.authorize,
          oldReply,
          "Titre automatique",
          "Mon suivi personnel",
        ),
      ).toBe(false);
      const f = await fixture(),
        reply = await f.addReply();
      await updateGeneratedConversationTitle(
        db,
        f.authorize,
        reply,
        "Titre automatique",
        "Nouvelle conversation",
      );
      await f.save({ ...(await f.read()), title: "Mon titre", version: 3 });
      expect(
        await updateGeneratedConversationTitle(
          db,
          f.authorize,
          await f.addReply(),
          "Nouveau sujet",
          "Mon titre",
        ),
      ).toBe(false);
    });
    it("does not turn archive/deletion edits into a last-write-wins rename", async () => {
      const f = await fixture(),
        reply = await f.addReply();
      await updateGeneratedConversationTitle(
        db,
        f.authorize,
        reply,
        "Titre automatique",
        "Nouvelle conversation",
      );
      const push = createMongoSyncPushService(database);
      const result = await push.push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId: f.f.storeId,
          deviceId: f.f.deviceId,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 10,
              type: "COPILOT_CONVERSATION_UPSERT",
              entityType: "copilot_conversation",
              entityId: f.f.conversation.id,
              expectedRemoteVersion: 1,
              createdAt: f.f.conversation.createdAt,
              payload: {
                ...f.f.conversation,
                title: "Renommage et archivage",
                titleIntent: "MANUAL",
                status: "ARCHIVED",
                version: 2,
              },
            },
          ],
        },
        randomUUID(),
        f.f.ownerId,
      );
      expect(result.results[0]?.status).toBe("CONFLICT");
      expect(await f.read()).toMatchObject({
        title: "Titre automatique",
        status: "ACTIVE",
        version: 2,
      });
    });
    it.each([
      "foreign",
      "revoked",
      "archived",
      "deleted",
      "changed",
      "invalid",
    ])("refuses %s state without altering the saved answer", async (kind) => {
      const f = await fixture(),
        reply = await f.addReply();
      if (kind === "archived")
        await f.save({ ...(await f.read()), status: "ARCHIVED", version: 2 });
      if (kind === "deleted")
        await f.save({
          ...(await f.read()),
          deletedMessageIds: [reply.id],
          version: 2,
        });
      if (kind === "changed")
        await f.save(
          { ...(await f.read()), title: "Choix utilisateur", version: 2 },
          "MANUAL",
        );
      const before = await f.read();
      const authorize =
        kind === "foreign"
          ? async () => ({ ...f.authority, ownerId: randomUUID() })
          : kind === "revoked"
            ? async () => ({ ...f.authority, canRespond: false })
            : f.authorize;
      expect(
        await updateGeneratedConversationTitle(
          db,
          authorize,
          reply,
          kind === "invalid" ? "x".repeat(81) : "Nouveau titre",
          "Nouvelle conversation",
        ),
      ).toBe(false);
      expect(await f.read()).toEqual(before);
      expect(
        await db
          .collection("copilotMessages")
          .countDocuments({ _id: reply.id as never }),
      ).toBe(1);
    });
  },
);
