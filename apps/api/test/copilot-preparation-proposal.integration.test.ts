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
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";
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
  it("blocks dangling TG assignments, accepts explicit replacement and scopes new retained offers", async () => {
    const f = await fixture(),
      added = await commercialChoiceFixture({ storeId: f.storeId });
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({
        _id: added.choice.id,
        duplicateKey: randomUUID(),
        ...added.choice,
      });
    const patch = {
      offerSelection: {
        addChoiceIds: [added.choice.id],
        removeChoiceIds: [f.choice.id],
      },
    };
    const blocked = await readPreparationPreview(db, f.storeId, {
      ...f.input,
      patch,
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(String(blocked.evidence[0].value)).toContain(
      f.preparation.placements[0].label,
    );
    const input = {
      ...f.input,
      patch: {
        ...patch,
        tgUpdates: [
          {
            placementId: f.preparation.placements[0].id,
            offerIds: [added.choice.id],
          },
        ],
      },
    };
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "READY",
    );
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: added.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialOfferChoices")
      .deleteOne({ _id: f.choice.id } as Document);
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...f.input,
          patch: {
            offerSelection: { removeChoiceIds: [f.choice.id] },
            tgUpdates: [
              { placementId: f.preparation.placements[0].id, offerIds: [] },
            ],
          },
        })
      ).status,
    ).toBe("READY");
    expect((await readPreparationPreview(db, randomUUID(), input)).status).toBe(
      "UNAVAILABLE",
    );
    expect(
      (await db
        .collection("commercialWeekPreparations")
        .findOne({ _id: f.preparation.id } as Document))!.offerRefs,
    ).toEqual(f.preparation.offerRefs);
  });
  it("refreshes only selected current applicable retained references, never downgrades and keeps invalid remaining choices blocked", async () => {
    const f = await fixture();
    const input = {
      weekStart: f.preparation.weekStart,
      patch: { refreshChoiceIds: [f.choice.id] },
    };
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "UNCHANGED",
    );
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, { $set: { version: 2 } });
    expect((await readPreparationPreview(db, f.storeId, f.input)).status).toBe(
      "BLOCKED",
    );
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "READY",
    );
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...input,
          patch: { refreshChoiceIds: [randomUUID()] },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { offerRefs: [{ choiceId: f.choice.id, choiceVersion: 3 }] },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { offerRefs: f.preparation.offerRefs },
      });
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: {
          status: "RETAINED",
          saleStart: "2027-01-01",
          saleEnd: "2027-01-02",
        },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
    expect((await readPreparationPreview(db, randomUUID(), input)).status).toBe(
      "UNAVAILABLE",
    );
    await db
      .collection("commercialOfferChoices")
      .deleteOne({ _id: f.choice.id } as Document);
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "UNAVAILABLE",
    );
  });
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
    .each(["EDIT", "LAYOUT", "SELECTION", "REFRESH"])(
    "atomically persists a compatible private TG review card (mode=%s) without business writes",
    async (mode) => {
      const layout = mode === "LAYOUT";
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
      if (mode === "REFRESH")
        await db
          .collection("commercialOfferChoices")
          .updateOne({ _id: f.choice.id } as Document, {
            $set: { version: 2 },
          });
      const input =
        mode === "REFRESH"
          ? {
              weekStart: f.preparation.weekStart,
              patch: { refreshChoiceIds: [f.choice.id] },
            }
          : mode === "SELECTION"
            ? {
                weekStart: f.preparation.weekStart,
                patch: {
                  offerSelection: { removeChoiceIds: [f.choice.id] },
                  tgUpdates: [
                    {
                      placementId: f.preparation.placements[0].id,
                      offerIds: [],
                    },
                  ],
                },
              }
            : layout
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
  it("initializes only a missing week from current retained choices without writing business data or inventing capacity", async () => {
    const f = await fixture(),
      input = {
        weekStart: f.preparation.weekStart,
        create: { choiceIds: [f.choice.id] },
        patch: {},
      };
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "ALREADY_EXISTS",
    );
    await db
      .collection("commercialWeekPreparations")
      .deleteOne({ _id: f.preparation.id } as Document);
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, { $set: { version: 3 } });
    const r = await readPreparationPreview(db, f.storeId, input);
    expect(r.status).toBe("READY");
    expect(r.basis?.preparation).toBeNull();
    expect(r.basis?.creationStoreId).toBe(f.storeId);
    const { prepareWeekPatch } = await import("@fl-copilot/domain");
    const request = prepareWeekPatch(r.input, r.basis!, randomUUID());
    expect(request.input).toMatchObject({
      expectedVersion: null,
      draft: {
        tgCapacity: null,
        offerRefs: [{ choiceId: f.choice.id, choiceVersion: 3 }],
      },
    });
    expect(
      await db
        .collection("commercialWeekPreparations")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    const empty = await readPreparationPreview(db, f.storeId, {
      ...input,
      create: { choiceIds: [] },
    });
    expect(empty.status).toBe("READY");
    expect(empty.basis?.choices).toEqual([]);
  });
  it("rejects missing/foreign/withdrawn/out-of-week initial choices and undeclared TG capacity", async () => {
    const f = await fixture(),
      input = {
        weekStart: f.preparation.weekStart,
        create: { choiceIds: [f.choice.id] },
        patch: {},
      };
    await db
      .collection("commercialWeekPreparations")
      .deleteOne({ _id: f.preparation.id } as Document);
    expect((await readPreparationPreview(db, randomUUID(), input)).status).toBe(
      "UNAVAILABLE",
    );
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...input,
          create: { choiceIds: [randomUUID()] },
        })
      ).status,
    ).toBe("UNAVAILABLE");
    expect(
      (
        await readPreparationPreview(db, f.storeId, {
          ...input,
          patch: {
            tgAdditions: [
              { label: "TG", theme: "Saison", offerIds: [f.choice.id] },
            ],
          },
        })
      ).status,
    ).toBe("BLOCKED");
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN" },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: {
          status: "RETAINED",
          saleStart: "2026-10-12",
          saleEnd: "2026-10-13",
        },
      });
    expect((await readPreparationPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists a private version-3 creation preview atomically, with no business creation; rejects forged creation scope (%s)",
    async (forged) => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      await db
        .collection("commercialWeekPreparations")
        .deleteOne({ _id: f.preparation.id } as Document);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Prépare cette nouvelle semaine.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readPreparationPreview(db, f.storeId, {
        weekStart: f.preparation.weekStart,
        create: { choiceIds: [f.choice.id] },
        patch: { note: "À préparer" },
      });
      if (forged) preview.basis!.creationStoreId = randomUUID();
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Nouvelle semaine préparée, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-week-create",
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
      if (forged) {
        await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
        expect(
          await db.collection("copilotMessages").countDocuments({
            conversationId: chat.conversation.id,
            role: { $in: ["ASSISTANT", "TOOL"] },
          }),
        ).toBe(0);
      } else {
        await runCopilotTurn(deps, turn);
        const cards = await db
          .collection("copilotMessages")
          .find({ conversationId: chat.conversation.id, role: "TOOL" })
          .toArray();
        expect(cards).toHaveLength(1);
        const { _id, ...payload } = cards[0],
          decoded = readCopilotPreparationProposal(payload);
        expect(decoded.content.schemaVersion).toBe(3);
        expect(decoded.request.input.expectedVersion).toBeNull();
        expect(
          await db.collection("syncChanges").countDocuments({ entityId: _id }),
        ).toBe(1);
        expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
        expect(generate).toHaveBeenCalledOnce();
      }
      expect(
        await db
          .collection("commercialWeekPreparations")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("commercialWeekPlans")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    },
  );
});
