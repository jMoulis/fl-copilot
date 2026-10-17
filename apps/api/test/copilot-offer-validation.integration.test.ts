import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { offerValidationPreviewFixture } from "../../../scripts/test-offer-validation-preview-fixtures";
import { testChoiceDigest } from "../../../scripts/test-commercial-choice-fixtures";
import { previewOfferValidation } from "../src/copilot/offer-validation-tool";
import { runMongoMigrations } from "../src/database/migrations";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
} from "@fl-copilot/commercial-core";
import { commercialValidatedOfferSchema } from "@fl-copilot/domain";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { readCopilotOfferValidationProposal } from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "reviewed offer validation previews on disposable Mongo",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_validation_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
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
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    async function seed(storeId?: string) {
      const data = await offerValidationPreviewFixture(storeId),
        f = data.f;
      await collection("commercialOfferChoices").insertOne({
        ...f.choice,
        _id: f.choice.id,
        duplicateKey: randomUUID(),
      });
      await collection("commercialVisualReadings").insertOne({
        ...f.reading,
        _id: f.reading.id,
      });
      await collection("products").insertOne({
        ...f.product,
        _id: f.product.id,
        schemaVersion: 1,
        packaging: null,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
      });
      return data;
    }
    it("reads a complete owned selection without writes, preserves immutable existing validation and reports all already validated", async () => {
      const one = await seed(),
        two = await seed(one.f.storeId),
        input = { choiceIds: [one.f.choice.id, two.f.choice.id] };
      const ready = await previewOfferValidation(db, one.f.storeId, input);
      expect(ready.status).toBe("READY");
      expect(ready.basis!.entries.map((e) => e.choice.id)).toEqual(
        input.choiceIds,
      );
      expect(
        await collection("commercialValidatedOffers").countDocuments({
          storeId: one.f.storeId,
        }),
      ).toBe(0);
      for (const [index, d] of [one, two].entries()) {
        const id = await commercialValidatedOfferId(
          d.f.storeId,
          d.f.choice.id,
          d.f.choice.version,
          testChoiceDigest,
        );
        const validation = commercialValidatedOfferSchema.parse({
          id,
          storeId: d.f.storeId,
          status: "VALIDATED",
          sourceReviewed: true,
          version: 1,
          choice: d.f.choice,
          ...commercialOfferValidationSource(d.f.choice, [d.f.reading]),
          createdAt: "2026-10-11T12:00:00Z",
        });
        await collection("commercialValidatedOffers").insertOne({
          ...validation,
          _id: id,
        });
        const next = await previewOfferValidation(db, one.f.storeId, input);
        expect(next.status).toBe(index === 0 ? "READY" : "UNCHANGED");
        expect(next.alreadyValidatedIds).toEqual(
          input.choiceIds.slice(0, index + 1),
        );
        if (index === 0)
          expect(next.basis!.entries[0]!.validation).toEqual(validation);
      }
    });
    it("blocks the entire selection with an actionable affected offer for changed units, missing sources and withdrawn choices", async () => {
      const one = await seed(),
        two = await seed(one.f.storeId),
        input = { choiceIds: [one.f.choice.id, two.f.choice.id] };
      await collection("products").updateOne(
        { _id: two.f.product.id },
        { $set: { salesUnit: "PIECE" } },
      );
      const blocked = await previewOfferValidation(db, one.f.storeId, input);
      expect(blocked.status).toBe("BLOCKED");
      expect(blocked.basis).toBeNull();
      expect(blocked.issue).toMatchObject({
        choiceId: two.f.choice.id,
        code: "UNIT_MISMATCH",
      });
      await collection("products").updateOne(
        { _id: two.f.product.id },
        { $set: { salesUnit: two.f.product.salesUnit } },
      );
      await collection("commercialVisualReadings").deleteOne({
        _id: two.f.reading.id,
      });
      expect(
        (await previewOfferValidation(db, one.f.storeId, input)).issue?.code,
      ).toBe("SOURCE_UNAVAILABLE");
      await collection("commercialOfferChoices").updateOne(
        { _id: two.f.choice.id },
        { $set: { status: "WITHDRAWN" } },
      );
      expect(
        (await previewOfferValidation(db, one.f.storeId, input)).issue?.code,
      ).toBe("WITHDRAWN");
      const foreign = await previewOfferValidation(db, randomUUID(), input);
      expect(foreign.status).toBe("UNAVAILABLE");
      expect(foreign.issue?.label).toBeNull();
      expect(foreign.basis).toBeNull();
    });
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each([false, true])(
      "persists offer-validation cards with the assistant transaction and rejects foreign scope (%s)",
      async (foreign) => {
        const { f, input } = await seed(),
          chat = chatFixture(randomUUID);
        chat.storeId = f.storeId;
        chat.conversation.storeId = f.storeId;
        chat.message.storeId = f.storeId;
        chat.message.attachments = [];
        chat.message.text =
          "Je veux valider les conditions de cette offre retenue.";
        await db
          .collection<Document & { _id: string }>("copilotConversations")
          .insertOne({ _id: chat.conversation.id, ...chat.conversation });
        await db
          .collection<Document & { _id: string }>("copilotMessages")
          .insertOne({ _id: chat.message.id, ...chat.message });
        const preview = await previewOfferValidation(db, f.storeId, input),
          generate = vi.fn(async () => ({
            output: {
              language: "fr-FR",
              summary: "Validation préparée, à confirmer.",
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
            offerValidations: [
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
          readCopilotOfferValidationProposal(payload).request.input.selection,
        ).toEqual([
          {
            choiceId: f.choice.id,
            choiceVersion: f.choice.version,
            productVersion: f.product.version,
          },
        ]);
        expect(
          await db.collection("syncChanges").countDocuments({ entityId: _id }),
        ).toBe(1);
        expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
        expect(generate).toHaveBeenCalledOnce();
        expect(
          await db
            .collection("commercialValidatedOffers")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      },
    );
    it("refuses a large complete review instead of truncating sources or skipping selected offers", async () => {
      const first = await seed(),
        all = [first];
      for (let i = 1; i < 12; i++) all.push(await seed(first.f.storeId));
      const result = await previewOfferValidation(db, first.f.storeId, {
        choiceIds: all.map((d) => d.f.choice.id),
      });
      expect(result.status).toBe("LIMIT_EXCEEDED");
      expect(result.basis).toBeNull();
      expect(result.input.choiceIds).toHaveLength(12);
    });
  },
);
