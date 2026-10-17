import { randomUUID, createHash } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { choiceCreateFixture } from "../../../scripts/test-choice-create-fixtures";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { previewChoiceCreate } from "../src/copilot/choice-create-tool";
import { runMongoMigrations } from "../src/database/migrations";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { readCopilotChoiceCreateProposal } from "@fl-copilot/domain";
import { commercialChoiceDuplicateKey } from "@fl-copilot/commercial-core";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "source-bound initial choice preparation on disposable Mongo",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_create_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });
    async function seed() {
      const data = await choiceCreateFixture(),
        f = data.f;
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .insertOne({
          _id: f.sourceDocumentId,
          storeId: f.storeId,
          checksum: f.reading.checksum,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        });
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .insertOne({ ...f.reading, _id: f.readingId });
      await db.collection<Document & { _id: string }>("products").insertOne({
        ...f.product,
        _id: f.product.id,
        schemaVersion: 1,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
        packaging: null,
      });
      return data;
    }
    it("prepares only exact owned sources/products, checks dates/units/duplicates and refuses retained or withdrawn existing choices", async () => {
      const { f, input } = await seed(),
        choices = db.collection<Document & { _id: string }>(
          "commercialOfferChoices",
        ),
        products = db.collection<Document & { _id: string }>("products");
      const ready = await previewChoiceCreate(db, f.storeId, input);
      expect(ready.status).toBe("READY");
      expect(ready.basis!.offer.source).toEqual(input.source);
      expect(await choices.countDocuments({ storeId: f.storeId })).toBe(0);
      expect((await previewChoiceCreate(db, randomUUID(), input)).status).toBe(
        "UNAVAILABLE",
      );
      expect(
        (
          await previewChoiceCreate(db, f.storeId, {
            ...input,
            source: { ...input.source, checksum: "wrong" },
          })
        ).status,
      ).toBe("UNAVAILABLE");
      expect(
        (
          await previewChoiceCreate(db, f.storeId, {
            ...input,
            source: { ...input.source, itemIndex: 59 },
          })
        ).status,
      ).toBe("BLOCKED");
      expect(
        (
          await previewChoiceCreate(db, f.storeId, {
            ...input,
            saleEnd: "2020-01-01",
          })
        ).status,
      ).toBe("BLOCKED");
      await products.updateOne(
        { _id: f.product.id },
        { $set: { salesUnit: "PIECE" } },
      );
      expect((await previewChoiceCreate(db, f.storeId, input)).status).toBe(
        "BLOCKED",
      );
      await products.updateOne(
        { _id: f.product.id },
        { $set: { salesUnit: f.product.salesUnit, status: "INACTIVE" } },
      );
      expect((await previewChoiceCreate(db, f.storeId, input)).status).toBe(
        "UNAVAILABLE",
      );
      await products.updateOne(
        { _id: f.product.id },
        { $set: { status: "ACTIVE" } },
      );
      const duplicate = {
        ...f.choice,
        id: randomUUID(),
        source: { ...input.source, itemIndex: 1 },
      };
      await choices.insertOne({
        ...duplicate,
        _id: duplicate.id,
        duplicateKey: createHash("sha256")
          .update(commercialChoiceDuplicateKey(duplicate))
          .digest("hex"),
      });
      expect((await previewChoiceCreate(db, f.storeId, input)).status).toBe(
        "BLOCKED",
      );
      await choices.deleteOne({ _id: duplicate.id });
      await choices.insertOne({
        ...f.choice,
        _id: f.choice.id,
        duplicateKey: randomUUID(),
      });
      expect((await previewChoiceCreate(db, f.storeId, input)).status).toBe(
        "ALREADY_EXISTS",
      );
      await choices.updateOne(
        { _id: f.choice.id },
        { $set: { status: "WITHDRAWN" } },
      );
      const withdrawn = await previewChoiceCreate(db, f.storeId, input);
      expect(withdrawn.status).toBe("ALREADY_EXISTS");
      expect(withdrawn.existingChoice!.status).toBe("WITHDRAWN");
    });
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each([false, true])(
      "persists initial-retention cards with the assistant transaction and rejects foreign scope (%s)",
      async (foreign) => {
        const { f, input } = await seed(),
          chat = chatFixture(randomUUID);
        chat.storeId = f.storeId;
        chat.conversation.storeId = f.storeId;
        chat.message.storeId = f.storeId;
        chat.message.attachments = [];
        chat.message.text = "Retiens cette offre du document pour ce produit.";
        await db
          .collection<Document & { _id: string }>("copilotConversations")
          .insertOne({ _id: chat.conversation.id, ...chat.conversation });
        await db
          .collection<Document & { _id: string }>("copilotMessages")
          .insertOne({ _id: chat.message.id, ...chat.message });
        const preview = await previewChoiceCreate(db, f.storeId, input),
          generate = vi.fn(async () => ({
            output: {
              language: "fr-FR",
              summary: "Offre préparée, à confirmer.",
              facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
              interpretation: [],
              recommendations: [],
              questions: [],
            },
            metadata: {
              requestedModel: "test",
              resolvedModel: "test",
              responseId: "test-create",
              inputTokens: null,
              outputTokens: null,
            },
            toolEvidence: preview.evidence,
            choiceCreates: [
              foreign
                ? {
                    ...preview,
                    basis: { ...preview.basis!, storeId: randomUUID() },
                  }
                : preview,
            ],
          }));
        const deps = {
            db,
            provider: { model: "test", generate } as CopilotAiProvider,
            authorize: async () => ({
              storeId: f.storeId,
              ownerId: chat.ownerId,
              canRespond: true,
            }),
            loadContext: async () =>
              detectCopilotConflicts({
                batch: scoreCopilotPriorities({
                  storeId: f.storeId,
                  evaluatedAt: chat.message.createdAt,
                  candidates: [],
                }),
                intents: [],
              }),
          },
          turn = {
            conversationId: chat.conversation.id,
            userMessageId: chat.message.id,
            replyId: randomUUID(),
          };
        if (foreign) {
          await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
          expect(
            await db.collection("copilotMessages").countDocuments({
              conversationId: chat.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            }),
          ).toBe(0);
          return;
        }
        await runCopilotTurn(deps, turn);
        const cards = await db
          .collection("copilotMessages")
          .find({ conversationId: chat.conversation.id, role: "TOOL" })
          .toArray();
        expect(cards).toHaveLength(1);
        const { _id, ...payload } = cards[0]!;
        expect(
          readCopilotChoiceCreateProposal(payload).request.input
            .expectedVersion,
        ).toBeNull();
        expect(
          await db.collection("syncChanges").countDocuments({ entityId: _id }),
        ).toBe(1);
        expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
        expect(generate).toHaveBeenCalledOnce();
        expect(
          await db
            .collection("commercialOfferChoices")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      },
    );
    it("blocks an oversized complete source review instead of truncating it", async () => {
      const { f, input } = await seed(),
        field = f.reading.reading!.operations[0]!.items[0]!.fields[0]!;
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .updateOne(
          { _id: f.readingId },
          {
            $set: {
              "reading.operations.0.items.0.fields": Array.from(
                { length: 30 },
                () => ({ ...field, rawValue: "é".repeat(2000) }),
              ),
            },
          },
        );
      const preview = await previewChoiceCreate(db, f.storeId, input);
      expect(preview.status).toBe("LIMIT_EXCEEDED");
      expect(preview.basis).toBeNull();
      expect(
        await db
          .collection("commercialOfferChoices")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    });
  },
);
