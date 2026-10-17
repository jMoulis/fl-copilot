import { vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { readCopilotChoiceWithdrawalProposal } from "@fl-copilot/domain";
import { previewChoiceWithdrawal } from "../src/copilot/choice-withdrawal-tool";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";
import { readCommercialChoice } from "../src/copilot/commercial-choice-tool";
import { runMongoMigrations } from "../src/database/migrations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("exact owned commercial choice inspection", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(
      `fl_choice_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
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
  it("reads current retained and withdrawn terms outside a requested week without business writes", async () => {
    const f = await commercialChoiceFixture();
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    const input = { choiceId: f.choice.id };
    const first = await readCommercialChoice(db, f.choice.storeId, input);
    expect(first.choice).toEqual(f.choice);
    expect(first.evidence[0].value).toContain("ne prouve ni une validation");
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN", version: 2 },
      });
    const before = await db
      .collection("commercialOfferChoices")
      .findOne({ _id: f.choice.id } as Document);
    const withdrawn = await readCommercialChoice(db, f.choice.storeId, input);
    expect(withdrawn.choice).toMatchObject({
      status: "WITHDRAWN",
      version: 2,
      source: f.choice.source,
      mechanism: f.choice.mechanism,
    });
    expect(withdrawn.evidence[0].factKind).toBe("QUALITY");
    expect(withdrawn.evidence[0].id).not.toBe(first.evidence[0].id);
    expect(
      await db
        .collection("commercialOfferChoices")
        .findOne({ _id: f.choice.id } as Document),
    ).toEqual(before);
    for (const c of [
      "commercialChoiceHistory",
      "commercialWeekPreparations",
      "commercialWeekPlans",
      "commercialValidatedOffers",
      "syncChanges",
    ])
      expect(await db.collection(c).countDocuments({})).toBe(0);
  });
  it("does not disclose another store's choice and distinguishes unavailable synchronized data", async () => {
    const f = await commercialChoiceFixture();
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    for (const [storeId, choiceId] of [
      [randomUUID(), f.choice.id],
      [f.choice.storeId, randomUUID()],
    ]) {
      const r = await readCommercialChoice(db, storeId, { choiceId });
      expect(r.choice).toBeNull();
      expect(r.evidence[0].sourceId).toBe(storeId);
      expect(JSON.stringify(r.evidence)).not.toContain(
        f.choice.rawProductLabel,
      );
    }
    await expect(
      readCommercialChoice(db, f.choice.storeId, {
        choiceId: f.choice.id,
        storeId: randomUUID(),
      }),
    ).rejects.toThrow();
  });
  it("prepares only retained owned choices and leaves already withdrawn/missing choices unchanged", async () => {
    const f = await commercialChoiceFixture(),
      input = { choiceId: f.choice.id };
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    expect(
      (await previewChoiceWithdrawal(db, f.choice.storeId, input)).status,
    ).toBe("READY");
    expect(
      (await previewChoiceWithdrawal(db, randomUUID(), input)).status,
    ).toBe("UNAVAILABLE");
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect(
      (await previewChoiceWithdrawal(db, f.choice.storeId, input)).status,
    ).toBe("UNCHANGED");
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists the private reviewed card with the reply atomically and replays without business withdrawal (foreign=%s)",
    async (foreign) => {
      const f = await commercialChoiceFixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.choice.storeId;
      chat.conversation.storeId = f.choice.storeId;
      chat.message.storeId = f.choice.storeId;
      chat.message.attachments = [];
      chat.message.text = "Retire cette offre retenue.";
      await db
        .collection<Document & { _id: string }>("commercialOfferChoices")
        .insertOne({
          _id: f.choice.id,
          duplicateKey: randomUUID(),
          ...f.choice,
        });
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await previewChoiceWithdrawal(db, f.choice.storeId, {
        choiceId: f.choice.id,
      });
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Retrait préparé, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-withdraw",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        choiceWithdrawals: [
          foreign
            ? {
                ...preview,
                before: { ...preview.before!, storeId: randomUUID() },
              }
            : preview,
        ],
      }));
      const deps = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.choice.storeId,
          ownerId: chat.ownerId,
          canRespond: true,
        }),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.choice.storeId,
              evaluatedAt: chat.message.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: chat.conversation.id,
        userMessageId: chat.message.id,
        replyId: randomUUID(),
      };
      if (foreign) {
        await expect(runCopilotTurn(deps, turn)).rejects.toThrow("SCOPE");
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
      const { _id, ...payload } = cards[0];
      expect(
        readCopilotChoiceWithdrawalProposal(payload).content.before,
      ).toEqual(f.choice);
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        (await db
          .collection("commercialOfferChoices")
          .findOne({ _id: f.choice.id } as Document))!.status,
      ).toBe("RETAINED");
    },
  );
});
