import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { ReceiptTestDatabase } from "../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { applyCopilotRecord } from "../../mobile/src/copilot/conversation-repository";
import { readAnswerSource } from "../../mobile/src/copilot/answer-source";
import { readRetailExpertise } from "../src/copilot/retail-expertise-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { runMongoMigrations } from "../src/database/migrations";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "curated expertise in owned durable conversations",
  () => {
    let client: MongoClient, db: Db;
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_expertise_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
    async function fixture() {
      const f = chatFixture(randomUUID);
      f.message.attachments = [];
      f.message.text = "Comment rendre l’offre plus visible ?";
      await collection("copilotConversations").insertOne({
        _id: f.conversation.id,
        ...f.conversation,
      });
      await collection("copilotMessages").insertOne({
        _id: f.message.id,
        ...f.message,
      });
      const reference = readRetailExpertise(
        { topics: ["VISIBILITY"] },
        "2026-10-18T12:00:00.000Z",
      );
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Une piste à vérifier sur le terrain.",
          narrative:
            "Une présentation plus visible peut être testée. Vérifions l’emplacement et la disponibilité avant de conclure. {{source:0}}",
          facts: reference.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-expertise",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: reference.evidence,
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: f.ownerId,
          canRespond: true,
        }),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: f.message.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
        replyId: randomUUID(),
      };
      return { f, reference, generate, dependencies, turn };
    }
    it("retains edition, caveats and original URLs in a private reply, replays once and restores the citation offline", async () => {
      const s = await fixture();
      const first = await runCopilotTurn(s.dependencies, s.turn);
      expect(first.message.text).toContain("copilot-source:");
      const encoded = /copilot-source:([^)]*)/.exec(first.message.text)![1]!;
      expect(readAnswerSource(encoded).retailExpertise).toEqual(
        s.reference.cards[0]!.citation,
      );
      const replay = await runCopilotTurn(s.dependencies, s.turn);
      expect(replay.alreadyApplied).toBe(true);
      expect(replay.message).toEqual(first.message);
      expect(s.generate).toHaveBeenCalledOnce();
      expect(
        await collection("copilotMessages").countDocuments({
          conversationId: s.f.conversation.id,
          role: "ASSISTANT",
        }),
      ).toBe(1);
      for (const name of [
        "products",
        "salesObservations",
        "wasteObservations",
        "sourceDocuments",
        "copilotKnowledge",
        "copilotWebResearch",
      ])
        expect(
          await collection(name).countDocuments({ storeId: s.f.storeId }),
        ).toBe(0);
      const sqlite = new DatabaseSync(":memory:"),
        local = new ReceiptTestDatabase(sqlite);
      try {
        await runLocalMigrations(local);
        await local.withExclusiveTransactionAsync(async (tx) => {
          await applyCopilotRecord(
            tx,
            s.f,
            "copilot_conversation",
            s.f.conversation,
          );
          await applyCopilotRecord(tx, s.f, "copilot_message", s.f.message);
          await applyCopilotRecord(tx, s.f, "copilot_message", first.message);
        });
        const row = await local.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=?",
          first.message.id,
        );
        const restoredText = JSON.parse(row!.payload_json).text;
        expect(
          readAnswerSource(/copilot-source:([^)]*)/.exec(restoredText)![1]!)
            .retailExpertise,
        ).toEqual(s.reference.cards[0]!.citation);
        expect(
          sqlite.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
        ).toEqual({ n: 0 });
      } finally {
        sqlite.close();
      }
    });
    it.each(["OWNER", "STORE", "ARCHIVED"])(
      "does not return another private conversation’s curated reply (%s)",
      async (mode) => {
        const s = await fixture();
        await runCopilotTurn(s.dependencies, s.turn);
        if (mode === "ARCHIVED")
          await collection("copilotConversations").updateOne(
            { _id: s.f.conversation.id },
            { $set: { status: "ARCHIVED" } },
          );
        const authorize = async () => ({
          storeId: mode === "STORE" ? randomUUID() : s.f.storeId,
          ownerId: mode === "OWNER" ? randomUUID() : s.f.ownerId,
          canRespond: true,
        });
        await expect(
          runCopilotTurn({ ...s.dependencies, authorize }, s.turn),
        ).rejects.toThrow();
        expect(s.generate).toHaveBeenCalledOnce();
      },
    );
  },
);
