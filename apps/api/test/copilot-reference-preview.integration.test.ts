import { inspectCommercialReference } from "../src/copilot/reference-inspection-tool";
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
  it("retrieves the recorded decision in either order without writes", async () => {
    const f = await fixture(true);
    const input = {
      firstDocumentId: f.input.afterDocumentId,
      secondDocumentId: f.input.beforeDocumentId,
    };
    const r = await inspectCommercialReference(db, f.f.storeId, input);
    expect(r).toMatchObject({
      status: "RECORDED",
      reviewStatus: "MATCHING_SNAPSHOTS",
      decision: f.decision,
      first: { filename: f.basis.afterFilename },
      second: { filename: f.basis.beforeFilename },
    });
    expect(
      r.evidence
        .filter((e) => e.id.startsWith("commercial-pdf-source/"))
        .map((e) => e.value),
    ).toEqual([f.basis.afterFilename, f.basis.beforeFilename]);
    expect(r.evidence.at(-1)?.value).toContain(f.basis.beforeFilename);
    expect(
      await collection("syncChanges").countDocuments({ storeId: f.f.storeId }),
    ).toBe(0);
  });
  it("distinguishes missing decisions and unavailable foreign originals", async () => {
    const f = await fixture();
    const input = {
      firstDocumentId: f.input.beforeDocumentId,
      secondDocumentId: f.input.afterDocumentId,
    };
    expect(
      await inspectCommercialReference(db, f.f.storeId, input),
    ).toMatchObject({
      status: "NO_DECISION",
      decision: null,
      reviewStatus: null,
    });
    const foreign = await inspectCommercialReference(db, randomUUID(), input);
    expect(foreign).toMatchObject({
      status: "UNAVAILABLE",
      first: null,
      second: null,
      decision: null,
      reviewStatus: null,
    });
    expect(JSON.stringify(foreign)).not.toContain(f.decision.note);
  });
  it.each(["CHECKSUM", "NEW_READING", "MISSING", "EXTRA_PAGE"])(
    "qualifies the historical choice when source snapshots change (%s)",
    async (mode) => {
      const f = await fixture(true);
      const input = {
        firstDocumentId: f.input.beforeDocumentId,
        secondDocumentId: f.input.afterDocumentId,
      };
      if (mode === "CHECKSUM")
        await collection("sourceDocuments").updateOne(
          { _id: f.input.afterDocumentId },
          { $set: { checksum: "sha256:changed" } },
        );
      else if (mode === "MISSING")
        await collection("commercialVisualReadings").deleteOne({
          _id: f.g.reading.id,
        });
      else {
        const id = randomUUID();
        await collection("commercialVisualReadings").insertOne({
          ...f.g.reading,
          _id: id,
          id,
          model: mode === "NEW_READING" ? "test-new" : f.g.reading.model,
          pageNumber: mode === "EXTRA_PAGE" ? 2 : 1,
          pageCount: mode === "EXTRA_PAGE" ? 2 : 1,
          updatedAt: new Date(Date.now() + 1000),
        });
      }
      const r = await inspectCommercialReference(db, f.f.storeId, input);
      expect(r).toMatchObject({
        status: "RECORDED",
        reviewStatus: "REVIEW_REQUIRED",
        decision: f.decision,
      });
    },
  );
  it("bounds snapshot work and complete result size without hiding the limit", async () => {
    const f = await fixture(true);
    const input = {
      firstDocumentId: f.input.beforeDocumentId,
      secondDocumentId: f.input.afterDocumentId,
    };
    for (let page = 2; page <= 17; page++) {
      const id = randomUUID();
      await collection("commercialVisualReadings").insertOne({
        ...f.g.reading,
        _id: id,
        id,
        pageNumber: page,
        pageCount: 17,
        updatedAt: new Date(Date.now() + 1000),
      });
    }
    expect(
      await inspectCommercialReference(db, f.f.storeId, input),
    ).toMatchObject({
      status: "RECORDED",
      decision: f.decision,
      reviewStatus: "LIMIT_EXCEEDED",
    });
    await collection("commercialVersionDecisions").updateOne(
      { _id: f.decision.id },
      { $set: { "before.checksum": "x".repeat(15000) } },
    );
    expect(
      await inspectCommercialReference(db, f.f.storeId, input),
    ).toMatchObject({
      status: "LIMIT_EXCEEDED",
      decision: null,
      reviewStatus: null,
    });
  });
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
