import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { storeEventFixture } from "../../../scripts/test-store-event-fixtures";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { readOperationsPreview } from "../src/copilot/operations-preview-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { runMongoMigrations } from "../src/database/migrations";
import { readCopilotOperationsProposal } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("store operations chat proposals", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_ops_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
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
    const f = storeEventFixture(),
      storeId = f.event.storeId,
      { id, ...p } = f.product;
    await db.collection<Document & { _id: string }>("products").insertOne({
      _id: id,
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
      deletedAt: null,
    });
    return {
      ...f,
      storeId,
      input: {
        kind: "FIELD_CAPTURE" as const,
        action: "PREPARE" as const,
        productId: id,
        patch: {
          type: "OUT_OF_STOCK" as const,
          startedAt: "2026-10-09T11:30:00+02:00",
        },
      },
    };
  }
  it("prepares an exact active product observation without writes, with offset dates and missing/future/foreign guards", async () => {
    const f = await fixture(),
      result = await readOperationsPreview(db, f.storeId, f.input);
    expect(result.status).toBe("READY");
    expect(result.basis.product!.id).toBe(f.product.id);
    expect(
      (await readOperationsPreview(db, randomUUID(), f.input)).status,
    ).toBe("UNAVAILABLE");
    const missing = await readOperationsPreview(db, f.storeId, {
      ...f.input,
      patch: { type: "OUT_OF_STOCK" },
    });
    expect(missing.status).toBe("NEEDS_INFORMATION");
    expect(missing.missingFields).toContain("startedAt");
    expect(
      (
        await readOperationsPreview(db, f.storeId, {
          ...f.input,
          patch: { ...f.input.patch, startedAt: "2099-01-01T12:00:00Z" },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      await db
        .collection("storeProductEvents")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
  });
  it("closes only a USER observation and retains closed-time immutability and same-instant no-op", async () => {
    const f = await fixture();
    await db
      .collection<Document & { _id: string }>("storeProductEvents")
      .insertOne({ _id: f.event.id, ...f.event });
    const input = {
      kind: "FIELD_CLOSE",
      action: "PREPARE",
      eventId: f.event.id,
      patch: { endedAt: "2026-10-09T11:45:00+02:00" },
    };
    expect((await readOperationsPreview(db, f.storeId, input)).status).toBe(
      "READY",
    );
    expect(
      (
        await readOperationsPreview(db, f.storeId, {
          ...input,
          patch: { endedAt: "2026-10-09T08:00:00Z" },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("storeProductEvents")
      .updateOne({ _id: f.event.id } as Document, {
        $set: { status: "CLOSED", endedAt: "2026-10-09T09:45:00.000Z" },
      });
    expect((await readOperationsPreview(db, f.storeId, input)).status).toBe(
      "UNCHANGED",
    );
    expect(
      (
        await readOperationsPreview(db, f.storeId, {
          ...input,
          patch: { endedAt: "2026-10-09T09:50:00Z" },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("storeProductEvents")
      .updateOne({ _id: f.event.id } as Document, {
        $set: {
          source: "COMMERCIAL_PDF",
          sourceDocumentId: randomUUID(),
          status: "ACTIVE",
          endedAt: null,
        },
      });
    expect((await readOperationsPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
  });
  it("exposes no GPS point/capture/fingerprint and asks for deliberate location/zone decisions on address changes", async () => {
    const settings = {
      ...storeContextFixture(),
      locationMode: "POINT",
      position: {
        latitude: 48.123456,
        longitude: 2.345678,
        capturedAt: "2026-10-01T07:12:34.000Z",
        source: "DEVICE",
      },
    };
    await db
      .collection<Document & { _id: string }>("storeContextSettings")
      .insertOne({ _id: settings.id, ...settings });
    const input = {
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { schoolZone: "B" },
    };
    const result = await readOperationsPreview(db, settings.storeId, input);
    expect(result.status).toBe("READY");
    const text = JSON.stringify(result);
    for (const forbidden of [
      "latitude",
      "longitude",
      '"position":',
      "capturedAt",
      "48.123456",
      "2.345678",
      settings.position.capturedAt,
    ])
      expect(text).not.toContain(forbidden);
    expect(
      (
        await readOperationsPreview(db, settings.storeId, {
          ...input,
          action: "INSPECT",
          patch: {},
        })
      ).status,
    ).toBe("INSPECTED");
    const move = {
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { city: "Lyon", postalCode: "69001" },
    };
    expect(
      (await readOperationsPreview(db, settings.storeId, move)).missingFields,
    ).toEqual(["location"]);
    expect(
      (
        await readOperationsPreview(db, settings.storeId, {
          ...move,
          patch: { ...move.patch, location: "CITY" },
        })
      ).missingFields,
    ).toEqual(["schoolZone"]);
    expect(
      (
        await readOperationsPreview(db, settings.storeId, {
          ...move,
          patch: { ...move.patch, location: "CITY", schoolZone: null },
        })
      ).status,
    ).toBe("READY");
    expect(
      (
        await readOperationsPreview(db, settings.storeId, {
          ...input,
          patch: { schoolZone: "C" },
        })
      ).status,
    ).toBe("UNCHANGED");
    expect(
      (await db
        .collection("storeContextSettings")
        .findOne({ _id: settings.id } as Document))!.position,
    ).toEqual(settings.position);
    const missing = await readOperationsPreview(db, randomUUID(), {
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { city: "Paris" },
    });
    expect(missing.status).toBe("NEEDS_INFORMATION");
    expect(missing.missingFields).toContain("postalCode");
  });
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "commits one private operations card with the reply and replays it after restart without a business declaration",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Signale la rupture de ce produit.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readOperationsPreview(db, f.storeId, f.input);
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
        operationsPreviews: [preview],
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
      expect(readCopilotOperationsProposal(payload).content.input.kind).toBe(
        f.input.kind,
      );
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
    "rolls back reply and private artifacts when a operations preview has forged scope",
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
      const preview = await readOperationsPreview(db, f.storeId, f.input);
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
        operationsPreviews: [
          {
            ...preview,
            basis: {
              ...preview.basis,
              product: { ...preview.basis.product!, storeId: randomUUID() },
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
