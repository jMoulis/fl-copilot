import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { commercialPlanFixture } from "../../../scripts/test-commercial-plan-fixtures";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { readPreparationPreview } from "../src/copilot/preparation-preview-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import { readCopilotPreparationProposal } from "@fl-copilot/domain";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("private TG draft proposals", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_tg_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
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
    const f = await commercialPlanFixture();
    await db
      .collection<Document & { _id: string }>("commercialWeekPreparations")
      .insertOne({ _id: f.preparation.id, ...f.preparation });
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    return {
      ...f,
      input: {
        weekStart: f.preparation.weekStart,
        patch: {
          tgUpdates: [
            {
              placementId: f.preparation.placements[0].id,
              theme: "Fruits de saison",
            },
          ],
        },
      },
    };
  }
  it("prepares without writing, preserves no-op and rejects missing, foreign or impossible draft changes", async () => {
    const f = await fixture();
    const r = await readPreparationPreview(db, f.storeId, f.input);
    expect(r.status).toBe("READY");
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...f.input,
          patch: { note: f.preparation.note },
        })
      ).status,
    ).toBe("UNCHANGED");
    expect(
      (await readPreparationPreview(db, randomUUID(), f.input)).status,
    ).toBe("UNAVAILABLE");
    for (const patch of [
      { tgCapacity: 0 },
      { tgUpdates: [{ placementId: randomUUID(), theme: "X" }] },
      {
        tgUpdates: [
          {
            placementId: f.preparation.placements[0].id,
            offerIds: [randomUUID()],
          },
        ],
      },
    ])
      expect(
        (await readPreparationPreview(db, f.storeId, { ...f.input, patch }))
          .status,
      ).toBe("BLOCKED");
    expect(
      await db
        .collection("commercialWeekPlans")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    expect(
      (await db
        .collection("commercialWeekPreparations")
        .findOne({ _id: f.preparation.id } as Document))!.version,
    ).toBe(1);
  });
  it("blocks stale or withdrawn references and keeps missing choice scope unavailable", async () => {
    const f = await fixture();
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, { $set: { version: 2 } });
    expect((await readPreparationPreview(db, f.storeId, f.input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect((await readPreparationPreview(db, f.storeId, f.input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialOfferChoices")
      .deleteOne({ _id: f.choice.id } as Document);
    expect((await readPreparationPreview(db, f.storeId, f.input)).status).toBe(
      "UNAVAILABLE",
    );
  });
  it("reports an oversized complete review explicitly instead of truncating or breaking the reply", async () => {
    const f = await fixture();
    const placements = Array.from({ length: 30 }, (_, i) => ({
      ...f.preparation.placements[0],
      id: randomUUID(),
      label: String(i).padStart(2, "0") + "a".repeat(78),
      theme: "b".repeat(240),
    }));
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { placements, tgCapacity: 30, note: "n".repeat(1200) },
      });
    const r = await readPreparationPreview(db, f.storeId, {
      weekStart: f.preparation.weekStart,
      patch: { note: "Autre note" },
    });
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.basis).toBeNull();
    expect(String(r.evidence[0].value)).toContain("trop volumineux");
  });
  it("prepares additions/removals only within declared capacity and selected offers without changing the remote draft", async () => {
    const f = await fixture(),
      before = await db
        .collection("commercialWeekPreparations")
        .findOne({ _id: f.preparation.id } as Document),
      tg = f.preparation.placements[0];
    const addition = {
      label: "TG nouvelle",
      theme: "Saison",
      offerIds: [f.choice.id],
    };
    const raw = {
      weekStart: f.preparation.weekStart,
      patch: { tgRemovals: [tg.id], tgAdditions: [addition] },
    };
    expect((await readPreparationPreview(db, f.storeId, raw)).status).toBe(
      "READY",
    );
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...raw,
          patch: { tgAdditions: [addition] },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...raw,
          patch: { tgCapacity: 2, tgAdditions: [addition] },
        })
      ).status,
    ).toBe("READY");
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...raw,
          patch: { tgRemovals: [randomUUID()] },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...raw,
          patch: {
            tgRemovals: [tg.id],
            tgAdditions: [{ ...addition, offerIds: [randomUUID()] }],
          },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      await db
        .collection("commercialWeekPreparations")
        .findOne({ _id: f.preparation.id } as Document),
    ).toEqual(before);
    expect(
      await db
        .collection("commercialWeekPlans")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "atomically persists a compatible private TG review card (layout=%s) without business writes",
    async (layout) => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Prépare cette TG.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const input = layout
        ? {
            weekStart: f.preparation.weekStart,
            patch: {
              tgRemovals: [f.preparation.placements[0].id],
              tgAdditions: [
                {
                  label: "Nouvelle TG",
                  theme: "Saison",
                  offerIds: [f.choice.id],
                },
              ],
            },
          }
        : f.input;
      const preview = await readPreparationPreview(db, f.storeId, input);
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Brouillon préparé, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-tg",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        preparationPreviews: [preview],
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
      };
      const turn = {
        conversationId: chat.conversation.id,
        userMessageId: chat.message.id,
        replyId: randomUUID(),
      };
      await runCopilotTurn(deps, turn);
      const cards = await db
        .collection("copilotMessages")
        .find({ conversationId: chat.conversation.id, role: "TOOL" })
        .toArray();
      expect(cards).toHaveLength(1);
      const { _id, ...payload } = cards[0];
      expect(readCopilotPreparationProposal(payload).content.input).toEqual(
        input,
      );
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        (await db
          .collection("commercialWeekPreparations")
          .findOne({ _id: f.preparation.id } as Document))!.version,
      ).toBe(1);
      expect(
        await db
          .collection("commercialWeekPlans")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    },
  );
});
