import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { readCataloguePreview } from "../src/copilot/catalogue-preview-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { runMongoMigrations } from "../src/database/migrations";
import { readCopilotCatalogueProposal } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("catalogue chat proposals", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_cat_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  async function fixture() {
    const storeId = randomUUID(),
      productId = randomUUID(),
      now = new Date("2026-10-05T08:00:00Z");
    await db.collection<Document & { _id: string }>("products").insertOne({
      _id: productId,
      storeId,
      label: "BANANE VRAC",
      category: "FRUIT",
      nature: "BULK",
      salesUnit: "KG",
      packaging: null,
      familyId: null,
      subfamilyId: null,
      status: "ACTIVE",
      version: 1,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return {
      storeId,
      productId,
      input: {
        action: "UPDATE" as const,
        productId,
        patch: { label: "BANANE JAUNE VRAC" },
      },
    };
  }
  it("allows inactive inspection and maintenance only for compatible clients, without restoring or deleting a product", async () => {
    const f = await fixture();
    await db.collection("products").updateOne(
      { storeId: f.storeId },
      {
        $set: { status: "INACTIVE" },
      },
    );
    const before = await db
      .collection("products")
      .findOne({ storeId: f.storeId });
    const v2 = { allowInactiveMaintenance: true };
    for (const action of ["INSPECT", "UPDATE"] as const) {
      const input = {
        ...f.input,
        action,
        patch: action === "INSPECT" ? {} : f.input.patch,
      };
      expect((await readCataloguePreview(db, f.storeId, input)).status).toBe(
        "UNAVAILABLE",
      );
      const preview = await readCataloguePreview(db, f.storeId, input, v2);
      expect(preview.status).toBe(action === "INSPECT" ? "INSPECTED" : "READY");
      expect(preview.before?.product.entity.status).toBe("INACTIVE");
      expect(preview.evidence[0]?.value).toContain("inactive et le restera");
    }
    expect(
      (
        await readCataloguePreview(
          db,
          f.storeId,
          { action: "RETIRE", productId: f.productId, patch: {} },
          v2,
        )
      ).status,
    ).toBe("UNAVAILABLE");
    expect(
      (await readCataloguePreview(db, randomUUID(), f.input, v2)).status,
    ).toBe("UNAVAILABLE");
    expect(
      await db.collection("products").findOne({ storeId: f.storeId }),
    ).toEqual(before);
    await db
      .collection("products")
      .updateOne({ storeId: f.storeId }, { $set: { deletedAt: new Date() } });
    expect(
      (await readCataloguePreview(db, f.storeId, f.input, v2)).status,
    ).toBe("UNAVAILABLE");
  });
  it("reads full children, preserves unrequested fields and leading zeros, refuses foreign products and oversized child sets", async () => {
    const f = await fixture(),
      id = randomUUID(),
      now = new Date();
    await db
      .collection<Document & { _id: string }>("productIdentifiers")
      .insertOne({
        _id: id,
        storeId: f.storeId,
        productId: f.productId,
        type: "PLU",
        value: "00042",
        source: "USER",
        status: "VALIDATED",
        version: 1,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    const inspected = await readCataloguePreview(db, f.storeId, {
      action: "INSPECT",
      productId: f.productId,
      patch: {},
    });
    expect(inspected.status).toBe("INSPECTED");
    expect(inspected.before!.identifiers[0]!.entity.value).toBe("00042");
    const result = await readCataloguePreview(db, f.storeId, f.input);
    expect(result.status).toBe("READY");
    expect(result.before!.product.entity.label).toBe("BANANE VRAC");
    expect((await readCataloguePreview(db, randomUUID(), f.input)).status).toBe(
      "UNAVAILABLE",
    );
    expect(
      (
        await readCataloguePreview(db, f.storeId, {
          ...f.input,
          patch: { label: "BANANE VRAC" },
        })
      ).status,
    ).toBe("UNCHANGED");
    expect(
      (
        await readCataloguePreview(db, f.storeId, {
          action: "RETIRE",
          productId: f.productId,
          patch: {},
        })
      ).status,
    ).toBe("READY");
    expect(
      (
        await readCataloguePreview(db, f.storeId, {
          action: "CREATE",
          productId: null,
          patch: { label: "Figue" },
        })
      ).status,
    ).toBe("READY");
    for (let i = 0; i < 20; i++)
      await db
        .collection<Document & { _id: string }>("productIdentifiers")
        .insertOne({
          _id: randomUUID(),
          storeId: f.storeId,
          productId: f.productId,
          type: "PLU",
          value: String(i),
          source: "USER",
          status: "VALIDATED",
          version: 1,
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
    expect((await readCataloguePreview(db, f.storeId, f.input)).status).toBe(
      "LIMIT_EXCEEDED",
    );
    expect(
      (await db.collection("products").findOne({ storeId: f.storeId }))!.label,
    ).toBe("BANANE VRAC");
  });
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "commits one private execution card with the reply and replays it after restart without a business declaration",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "J’ai imprimé cette affiche.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readCataloguePreview(db, f.storeId, f.input);
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Déclaration préparée, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-execution",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        cataloguePreviews: [preview],
      }));
      const dependencies = {
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
      };
      const turn = {
        conversationId: chat.conversation.id,
        userMessageId: chat.message.id,
        replyId: randomUUID(),
      };
      await runCopilotTurn(dependencies, turn);
      const cards = await db
        .collection("copilotMessages")
        .find({ conversationId: chat.conversation.id, role: "TOOL" })
        .toArray();
      expect(cards).toHaveLength(1);
      const { _id, ...payload } = cards[0]!;
      expect(
        readCopilotCatalogueProposal(payload).content.input.productId,
      ).toBe(f.input.productId);
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(dependencies, turn)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledOnce();
      expect(
        await db.collection("products").countDocuments({ storeId: f.storeId }),
      ).toBe(1);
    },
  );
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "rolls back reply and private artifacts when an execution preview has forged scope",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readCataloguePreview(db, f.storeId, f.input);
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Déclaration préparée.",
          facts: [],
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-rollback",
          inputTokens: null,
          outputTokens: null,
        },
        cataloguePreviews: [
          {
            ...preview,
            before: {
              ...preview.before!,
              product: {
                ...preview.before!.product,
                entity: {
                  ...preview.before!.product.entity,
                  storeId: randomUUID(),
                },
              },
            },
          },
        ],
      }));
      const replyId = randomUUID();
      await expect(
        runCopilotTurn(
          {
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
          {
            conversationId: chat.conversation.id,
            userMessageId: chat.message.id,
            replyId,
          },
        ),
      ).rejects.toThrow("SCOPE_INVALID");
      expect(
        await db.collection("copilotMessages").countDocuments({
          conversationId: chat.conversation.id,
          role: { $in: ["ASSISTANT", "TOOL"] },
        }),
      ).toBe(0);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ entityId: replyId }),
      ).toBe(0);
    },
  );
});
