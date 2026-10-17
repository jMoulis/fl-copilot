import { previewChoiceReassociation } from "../src/copilot/choice-reassociation-tool";
import { readCopilotChoiceReassociationProposal } from "@fl-copilot/domain";
import { previewChoiceUpdate } from "../src/copilot/choice-update-tool";
import { readCopilotChoiceUpdateProposal } from "@fl-copilot/domain";
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
import { randomUUID, createHash } from "node:crypto";
import { MongoClient, Decimal128, type Db, type Document } from "mongodb";
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
  it("prepares only requested retained-choice updates against an active product, preserves data and blocks invalid conditions", async () => {
    const f = await commercialChoiceFixture(),
      input = {
        choiceId: f.choice.id,
        patch: { note: "Adapter la présentation" },
      };
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    await db.collection<Document & { _id: string }>("products").insertOne({
      _id: f.product.id,
      ...f.product,
      schemaVersion: 1,
      createdAt: new Date(f.product.createdAt),
      updatedAt: new Date(f.product.updatedAt),
      deletedAt: null,
      packaging: f.product.packaging
        ? {
            ...f.product.packaging,
            quantity: Decimal128.fromString(
              String(f.product.packaging.quantity),
            ),
          }
        : null,
    });
    expect(
      (await previewChoiceUpdate(db, f.choice.storeId, input)).status,
    ).toBe("READY");
    expect(
      (
        await previewChoiceUpdate(db, f.choice.storeId, {
          ...input,
          patch: { note: f.choice.note },
        })
      ).status,
    ).toBe("UNCHANGED");
    expect((await previewChoiceUpdate(db, randomUUID(), input)).status).toBe(
      "UNAVAILABLE",
    );
    expect(
      (
        await previewChoiceUpdate(db, f.choice.storeId, {
          ...input,
          patch: { saleEnd: "2020-01-01" },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("products")
      .updateOne({ _id: f.product.id } as Document, {
        $set: { salesUnit: "KG" },
      });
    expect(
      (
        await previewChoiceUpdate(db, f.choice.storeId, {
          ...input,
          patch: {
            mechanism: {
              type: "FIXED_PRICE",
              amount: 2,
              currency: "EUR",
              unit: "PIECE",
            },
          },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect(
      (await previewChoiceUpdate(db, f.choice.storeId, input)).status,
    ).toBe("BLOCKED");
    expect(
      (await db
        .collection("commercialOfferChoices")
        .findOne({ _id: f.choice.id } as Document))!.note,
    ).toBe(f.choice.note);
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists reviewed choice-update cards atomically and rejects foreign product scope (%s)",
    async (foreign) => {
      const f = await commercialChoiceFixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.choice.storeId;
      chat.conversation.storeId = f.choice.storeId;
      chat.message.storeId = f.choice.storeId;
      chat.message.attachments = [];
      chat.message.text = "Modifie la note de cette offre.";
      await db
        .collection<Document & { _id: string }>("commercialOfferChoices")
        .insertOne({
          _id: f.choice.id,
          duplicateKey: randomUUID(),
          ...f.choice,
        });
      await db.collection<Document & { _id: string }>("products").insertOne({
        _id: f.product.id,
        ...f.product,
        schemaVersion: 1,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
        deletedAt: null,
        packaging: f.product.packaging
          ? {
              ...f.product.packaging,
              quantity: Decimal128.fromString(
                String(f.product.packaging.quantity),
              ),
            }
          : null,
      });
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await previewChoiceUpdate(db, f.choice.storeId, {
        choiceId: f.choice.id,
        patch: { note: "Modification demandée" },
      });
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Modification préparée, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-edit",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        choiceUpdates: [
          foreign
            ? {
                ...preview,
                basis: {
                  ...preview.basis!,
                  product: { ...preview.basis!.product, storeId: randomUUID() },
                },
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
      const { _id, ...payload } = cards[0];
      expect(
        readCopilotChoiceUpdateProposal(payload).request.input.draft.note,
      ).toBe("Modification demandée");
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        (await db
          .collection("commercialOfferChoices")
          .findOne({ _id: f.choice.id } as Document))!.note,
      ).toBe(f.choice.note);
    },
  );
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists reviewed choice-reassociation cards atomically and rejects foreign product scope (%s)",
    async (foreign) => {
      const f = await commercialChoiceFixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.choice.storeId;
      chat.conversation.storeId = f.choice.storeId;
      chat.message.storeId = f.choice.storeId;
      chat.message.attachments = [];
      chat.message.text = "Modifie la note de cette offre.";
      await db
        .collection<Document & { _id: string }>("commercialOfferChoices")
        .insertOne({
          _id: f.choice.id,
          duplicateKey: randomUUID(),
          ...f.choice,
        });
      const targetId = randomUUID();
      await db.collection<Document & { _id: string }>("products").insertOne({
        ...f.product,
        _id: targetId,
        id: targetId,
        schemaVersion: 1,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
        deletedAt: null,
        packaging: f.product.packaging
          ? {
              ...f.product.packaging,
              quantity: Decimal128.fromString(
                String(f.product.packaging.quantity),
              ),
            }
          : null,
      });
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await previewChoiceReassociation(db, f.choice.storeId, {
        choiceId: f.choice.id,
        productId: targetId,
      });
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Modification préparée, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-edit",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        choiceReassociations: [
          foreign
            ? {
                ...preview,
                basis: {
                  ...preview.basis!,
                  product: { ...preview.basis!.product, storeId: randomUUID() },
                },
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
      const { _id, ...payload } = cards[0];
      expect(
        readCopilotChoiceReassociationProposal(payload).request.input.draft
          .productId,
      ).toBe(targetId);
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        (await db
          .collection("commercialOfferChoices")
          .findOne({ _id: f.choice.id } as Document))!.note,
      ).toBe(f.choice.note);
    },
  );
  it("previews exact active target products, blocks units/duplicates/withdrawal and never changes choices", async () => {
    const f = await commercialChoiceFixture(),
      target = { ...f.product, id: randomUUID() },
      choices = db.collection<Document & { _id: string }>(
        "commercialOfferChoices",
      ),
      products = db.collection<Document & { _id: string }>("products");
    await choices.insertOne({
      _id: f.choice.id,
      ...f.choice,
      duplicateKey: randomUUID(),
    });
    const putProduct = async (p: typeof f.product) =>
      products.insertOne({
        ...p,
        _id: p.id,
        schemaVersion: 1,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        deletedAt: null,
        packaging: null,
      });
    await putProduct(target);
    const input = { choiceId: f.choice.id, productId: target.id };
    const ready = await previewChoiceReassociation(db, f.choice.storeId, input);
    expect(ready.status).toBe("READY");
    expect(ready.basis?.previousProduct).toBeNull();
    expect(
      (await previewChoiceReassociation(db, randomUUID(), input)).status,
    ).toBe("UNAVAILABLE");
    expect(
      (
        await previewChoiceReassociation(db, f.choice.storeId, {
          ...input,
          productId: randomUUID(),
        })
      ).status,
    ).toBe("UNAVAILABLE");
    await putProduct(f.product);
    expect(
      (
        await previewChoiceReassociation(db, f.choice.storeId, {
          ...input,
          productId: f.product.id,
        })
      ).status,
    ).toBe("UNCHANGED");
    await products.updateOne(
      { _id: target.id },
      { $set: { salesUnit: "PIECE" } },
    );
    expect(
      (await previewChoiceReassociation(db, f.choice.storeId, input)).status,
    ).toBe("BLOCKED");
    await products.updateOne(
      { _id: target.id },
      { $set: { salesUnit: f.product.salesUnit, status: "INACTIVE" } },
    );
    expect(
      (await previewChoiceReassociation(db, f.choice.storeId, input)).status,
    ).toBe("UNAVAILABLE");
    await products.updateOne(
      { _id: target.id },
      { $set: { status: "ACTIVE", storeId: randomUUID() } },
    );
    expect(
      (await previewChoiceReassociation(db, f.choice.storeId, input)).status,
    ).toBe("UNAVAILABLE");
    await products.updateOne(
      { _id: target.id },
      { $set: { storeId: f.choice.storeId } },
    );
    const { commercialChoiceDuplicateKey } =
      await import("@fl-copilot/commercial-core");
    const duplicate = {
      ...f.choice,
      id: randomUUID(),
      productId: target.id,
      source: { ...f.choice.source, itemIndex: 1 },
    };
    await choices.insertOne({
      ...duplicate,
      _id: duplicate.id,
      duplicateKey: createHash("sha256")
        .update(commercialChoiceDuplicateKey(duplicate))
        .digest("hex"),
    });
    expect(
      (await previewChoiceReassociation(db, f.choice.storeId, input)).status,
    ).toBe("BLOCKED");
    await choices.deleteOne({ _id: duplicate.id });
    await choices.updateOne(
      { _id: f.choice.id },
      { $set: { status: "WITHDRAWN" } },
    );
    expect(
      (await previewChoiceReassociation(db, f.choice.storeId, input)).status,
    ).toBe("BLOCKED");
    expect((await choices.findOne({ _id: f.choice.id }))!.productId).toBe(
      f.choice.productId,
    );
  });
});
