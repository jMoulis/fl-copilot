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
    async function setup(forged = false) {
      const chat = chatFixture(randomUUID),
        head = layoutFixture(chat.storeId, chat.ownerId);
      chat.message.attachments = [];
      chat.message.text =
        "Ajoute un mobile de vente sous cet élément, nommé Mobile pommes.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .insertOne({ _id: head.id, ...head });
      const input = {
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
    it("commits and synchronizes one immutable review card with the reply, replays without any physical business write", async () => {
      const s = await setup(),
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
      expect(p.content.input.action).toBe("ADD_MOBILE");
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
    });
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
