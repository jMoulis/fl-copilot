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
import { readStoreLayoutScenarioCard } from "@fl-copilot/domain";
import {
  readStoreLayoutScenarioSources,
  presentStoreLayoutScenario,
} from "../src/copilot/store-layout-scenario-tool";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { layoutScenarioFixture } from "../../../scripts/test-layout-scenario-fixtures";
import { nextLayout } from "../../../scripts/test-store-layout-fixtures";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private source-bound store allocation",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_alloc_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
        f = await layoutScenarioFixture(chat.storeId);
      chat.message.attachments = [];
      chat.message.text =
        "Propose une implantation de ces produits et de l’offre raisin.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .insertOne({ _id: chat.storeId, ...f.reference });
      for (const p of f.sources.products) {
        const { id, ...rest } = p;
        await db.collection<Document & { _id: string }>("products").insertOne({
          _id: id,
          ...rest,
          schemaVersion: 1,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          deletedAt: null,
        });
      }
      await db
        .collection<Document & { _id: string }>("commercialOfferChoices")
        .insertOne({
          _id: f.choice.choice.id,
          ...f.choice.choice,
          duplicateKey: randomUUID(),
        });
      const sources = await readStoreLayoutScenarioSources(
          db,
          chat.storeId,
          f.input,
        ),
        preview = presentStoreLayoutScenario(chat.storeId, f.input, sources);
      expect(preview.status).toBe("READY");
      if (forged) preview.scenario!.storeId = randomUUID();
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Voici une proposition à examiner.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-layout-scenario",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        layoutScenarios: [preview],
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
        f,
        preview,
        sources,
        generate,
        dependencies,
        turn: {
          conversationId: chat.conversation.id,
          userMessageId: chat.message.id,
          replyId: randomUUID(),
        },
      };
    }
    it("commits one private immutable proposal with its reply and sync change, replays exactly once and never writes business allocations or furniture", async () => {
      const s = await setup(),
        before = await db
          .collection("storeLayouts")
          .findOne({ _id: s.chat.storeId } as Document);
      await runCopilotTurn(s.dependencies, s.turn);
      const rows = await db
        .collection("copilotMessages")
        .find({ conversationId: s.chat.conversation.id, role: "TOOL" })
        .toArray();
      expect(rows).toHaveLength(1);
      const { _id, ...raw } = rows[0]!,
        card = readStoreLayoutScenarioCard(raw);
      expect(card.content.scenario).toEqual(s.preview.scenario);
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
          .findOne({ _id: s.chat.storeId } as Document),
      ).toEqual(before);
      expect(
        await db
          .collection("storeLayoutRevisions")
          .countDocuments({ storeId: s.chat.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("commercialWeekPreparations")
          .countDocuments({ storeId: s.chat.storeId }),
      ).toBe(0);
    });
    it("scopes exact reads to this store and uses the adopted history rather than a newer draft", async () => {
      const s = await setup(),
        draft = nextLayout(s.f.reference);
      draft.content.furniture[0]!.label = "Intention non adoptée";
      await db
        .collection<Document & { _id: string }>("storeLayoutRevisions")
        .insertOne({
          _id: s.f.reference.revisionId,
          id: s.f.reference.revisionId,
          storeId: s.chat.storeId,
          plan: s.f.reference,
          version: 1,
        });
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .replaceOne({ _id: s.chat.storeId }, { _id: s.chat.storeId, ...draft });
      const sources = await readStoreLayoutScenarioSources(
        db,
        s.chat.storeId,
        s.f.input,
      );
      const p = presentStoreLayoutScenario(s.chat.storeId, s.f.input, sources);
      expect(p.status).toBe("READY");
      expect(p.scenario?.physicalRevisionId).toBe(s.f.reference.revisionId);
      expect(JSON.stringify(p)).not.toContain("Intention non adoptée");
      const foreign = await readStoreLayoutScenarioSources(
        db,
        randomUUID(),
        s.f.input,
      );
      expect(foreign).toEqual({
        layout: { head: null, reference: null },
        products: [],
        choices: [],
      });
      const id = randomUUID(),
        adopted = nextLayout(draft, {
          action: "ADOPT_REFERENCE",
          revisionId: id,
          referenceRevisionId: id,
        });
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .replaceOne(
          { _id: s.chat.storeId },
          { _id: s.chat.storeId, ...adopted },
        );
      expect(
        presentStoreLayoutScenario(
          s.chat.storeId,
          s.f.input,
          await readStoreLayoutScenarioSources(db, s.chat.storeId, s.f.input),
        ).status,
      ).toBe("STALE");
    });
    it("refuses a dangling adopted history and a source offer whose canonical product is unavailable", async () => {
      const s = await setup();
      await db
        .collection("products")
        .deleteOne({ _id: s.f.choice.product.id } as Document);
      expect(
        presentStoreLayoutScenario(
          s.chat.storeId,
          s.f.input,
          await readStoreLayoutScenarioSources(db, s.chat.storeId, s.f.input),
        ).status,
      ).toBe("BLOCKED");
      const draft = nextLayout(s.f.reference);
      await db
        .collection<Document & { _id: string }>("storeLayouts")
        .replaceOne({ _id: s.chat.storeId }, { _id: s.chat.storeId, ...draft });
      await expect(
        readStoreLayoutScenarioSources(db, s.chat.storeId, s.f.input),
      ).rejects.toThrow("REFERENCE_UNAVAILABLE");
    });
    it("rolls back the reply and artifact when a proposal crosses store scope", async () => {
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
