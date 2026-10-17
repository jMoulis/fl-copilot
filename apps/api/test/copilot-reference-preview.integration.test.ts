import { runCopilotTurn } from "../src/copilot/turn-service";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { readCopilotReferenceProposal } from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { vi } from "vitest";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import { runMongoMigrations } from "../src/database/migrations";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { referencePreviewFixture } from "../../../scripts/test-reference-preview-fixtures";
import { previewCommercialReference } from "../src/copilot/reference-preview-tool";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("reference preview on disposable Mongo", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_ref_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
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
  async function fixture(existing = false) {
    const f = await referencePreviewFixture(existing);
    for (const p of [f.f.reading, f.g.reading]) {
      await collection("sourceDocuments").insertOne({
        _id: p.sourceDocumentId,
        storeId: p.storeId,
        checksum: p.checksum,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
        originalFilename:
          p.id === f.f.reading.id
            ? f.basis.beforeFilename
            : f.basis.afterFilename,
      });
      await collection("commercialVisualReadings").insertOne({
        ...p,
        _id: p.id,
        updatedAt: new Date(),
      });
    }
    if (existing)
      await collection("commercialVersionDecisions").insertOne({
        ...f.decision,
        _id: f.decision.id,
      });
    return f;
  }
  it("prepares exact snapshots without business writes", async () => {
    const f = await fixture();
    const r = await previewCommercialReference(db, f.f.storeId, f.input);
    expect(r.status).toBe("READY");
    expect(r.basis).toEqual(f.basis);
    for (const name of [
      "commercialVersionDecisions",
      "commercialWeekPlans",
      "commercialOfferChoices",
      "syncChanges",
    ])
      expect(
        await collection(name).countDocuments({ storeId: f.f.storeId }),
      ).toBe(0);
  });
  it("preserves a note, suppresses no-op revisions and allows explicit clearing", async () => {
    const f = await fixture(true);
    expect(
      (await previewCommercialReference(db, f.f.storeId, f.input)).basis
        ?.previous,
    ).toEqual(f.decision);
    expect(
      (
        await previewCommercialReference(db, f.f.storeId, {
          ...f.input,
          preference: f.decision.preference,
        })
      ).status,
    ).toBe("UNCHANGED");
    expect(
      (
        await previewCommercialReference(db, f.f.storeId, {
          ...f.input,
          preference: f.decision.preference,
          note: "",
        })
      ).status,
    ).toBe(f.decision.note === "" ? "UNCHANGED" : "READY");
  });
  it("does not expose another store's PDFs", async () => {
    const f = await fixture();
    expect(
      (await previewCommercialReference(db, randomUUID(), f.input)).status,
    ).toBe("UNAVAILABLE");
  });
  it("blocks reversed existing orientation", async () => {
    const f = await fixture(true);
    expect(
      await previewCommercialReference(db, f.f.storeId, {
        ...f.input,
        beforeDocumentId: f.input.afterDocumentId,
        afterDocumentId: f.input.beforeDocumentId,
      }),
    ).toMatchObject({ status: "BLOCKED", issue: "ORIENTATION", basis: null });
  });
  it("requires confirmed sources and complete current readings", async () => {
    const f = await fixture();
    await collection("sourceDocuments").updateOne(
      { _id: f.input.afterDocumentId },
      { $set: { remoteUploadStatus: "PENDING" } },
    );
    expect(
      (await previewCommercialReference(db, f.f.storeId, f.input)).status,
    ).toBe("UNAVAILABLE");
    await collection("sourceDocuments").updateOne(
      { _id: f.input.afterDocumentId },
      { $set: { remoteUploadStatus: "CONFIRMED" } },
    );
    await collection("commercialVisualReadings").deleteOne({
      _id: f.g.reading.id,
    });
    expect(
      await previewCommercialReference(db, f.f.storeId, f.input),
    ).toMatchObject({ status: "BLOCKED", issue: "INCOMPLETE", basis: null });
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists reference cards atomically and rejects foreign candidates (%s)",
    async (foreign) => {
      const base = await fixture(),
        f = { ...base, storeId: base.f.storeId },
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Je préfère le PDF corrigé après comparaison.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await previewCommercialReference(db, f.storeId, f.input),
        generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: "Plan préparé, à confirmer.",
            facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "test-plan",
            inputTokens: null,
            outputTokens: null,
          },
          toolEvidence: preview.evidence,
          referencePreviews: [
            foreign ? { ...preview, storeId: randomUUID() } : preview,
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
      const { _id, ...card } = cards[0]!;
      expect(readCopilotReferenceProposal(card).content.basis).toEqual(f.basis);
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
      expect(generate).toHaveBeenCalledOnce();
      expect(
        await db
          .collection("commercialWeekPlans")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    },
  );
});
