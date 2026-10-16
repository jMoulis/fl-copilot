import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import {
  substitutionFixture,
  substitutionDigest,
} from "../../../scripts/test-substitution-fixtures";
import { readNeedPreview } from "../src/copilot/need-preview-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { runMongoMigrations } from "../src/database/migrations";
import {
  readCopilotNeedProposal,
  needMembershipId,
  needProposalRefused,
} from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("need and relation chat proposals", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_need_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
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
    const f = await substitutionFixture(),
      storeId = f.need.storeId;
    await db
      .collection<Document & { _id: string }>("needUnits")
      .insertOne({ _id: f.need.id, ...f.need });
    for (const p of [f.product, f.substitute]) {
      const { id, ...data } = p;
      await db.collection<Document & { _id: string }>("products").insertOne({
        _id: id,
        ...data,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        deletedAt: null,
      });
    }
    return {
      ...f,
      storeId,
      input: {
        kind: "NEED" as const,
        action: "PREPARE" as const,
        needUnitId: f.need.id,
        patch: { name: "Salade express" },
      },
    };
  }
  it("prepares read-only need creation/partial update/deactivation, preserves code and reserves inactive codes", async () => {
    const f = await fixture(),
      changed = await readNeedPreview(db, f.storeId, f.input);
    expect(changed.status).toBe("READY");
    expect(changed.basis.need).toEqual(f.need);
    expect((await readNeedPreview(db, randomUUID(), f.input)).status).toBe(
      "UNAVAILABLE",
    );
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...f.input,
          patch: { name: f.need.name },
        })
      ).status,
    ).toBe("UNCHANGED");
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...f.input,
          action: "INSPECT",
          patch: {},
        })
      ).status,
    ).toBe("INSPECTED");
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...f.input,
          patch: { status: "INACTIVE" },
        })
      ).status,
    ).toBe("READY");
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          kind: "NEED",
          action: "PREPARE",
          needUnitId: null,
          patch: { name: "Nouveau repas" },
        })
      ).status,
    ).toBe("READY");
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          kind: "NEED",
          action: "PREPARE",
          needUnitId: null,
          patch: { name: f.need.code },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      (await db
        .collection("needUnits")
        .findOne({ _id: f.need.id } as Document))!.version,
    ).toBe(1);
  });
  it("retains rejected memberships, requests missing levels and blocks learned confidence replacement", async () => {
    const f = await fixture(),
      input = {
        kind: "MEMBERSHIP",
        action: "PREPARE",
        needUnitId: f.need.id,
        productId: f.product.id,
        patch: { decision: "VALIDATED" },
      };
    const missing = await readNeedPreview(db, f.storeId, input);
    expect(missing.status).toBe("NEEDS_INFORMATION");
    expect(missing.missingFields).toContain("strength");
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...input,
          patch: {
            decision: "VALIDATED",
            strength: 0.8,
            declaredConfidence: 0.6,
          },
        })
      ).status,
    ).toBe("READY");
    const id = await needMembershipId(
      f.storeId,
      f.product.id,
      f.need.id,
      substitutionDigest,
    );
    await db
      .collection<Document & { _id: string }>("needMemberships")
      .insertOne({
        _id: id,
        id,
        storeId: f.storeId,
        productId: f.product.id,
        needUnitId: f.need.id,
        strength: 0.8,
        confidence: 0.6,
        primary: false,
        source: "LEARNED",
        status: "REJECTED",
        humanConfirmed: true,
        version: 1,
        createdAt: f.need.createdAt,
        updatedAt: f.need.updatedAt,
      });
    const restored = await readNeedPreview(db, f.storeId, input);
    expect(restored.status).toBe("READY");
    expect(needProposalRefused(restored.input, restored.basis)).toBe(true);
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...input,
          patch: { decision: "VALIDATED", declaredConfidence: 0.9 },
        })
      ).status,
    ).toBe("BLOCKED");
    expect(
      (await db.collection("needMemberships").findOne({ _id: id } as Document))!
        .status,
    ).toBe("REJECTED");
  });
  it("preserves directed learned substitutions and does not infer the reverse edge", async () => {
    const f = await fixture(),
      record = {
        ...f.substitution,
        status: "LEARNING",
        humanConfirmed: true,
        observedSubstitution: 0.7,
        relationshipScore: 0.8,
        confidence: 0.6,
        evidenceCount: 2,
        lastEvidenceAt: f.need.updatedAt,
      };
    await db
      .collection<Document & { _id: string }>("productSubstitutions")
      .insertOne({ _id: record.id, ...record });
    const input = {
      kind: "SUBSTITUTION",
      action: "PREPARE",
      needUnitId: f.need.id,
      productId: f.product.id,
      substituteProductId: f.substitute.id,
      patch: { decision: "VALIDATED" },
    };
    const unchanged = await readNeedPreview(db, f.storeId, input);
    expect(unchanged.status).toBe("UNCHANGED");
    expect(unchanged.basis.substitution).toEqual(record);
    expect(
      (
        await readNeedPreview(db, f.storeId, {
          ...input,
          patch: { usageCompatibility: 0.9 },
        })
      ).status,
    ).toBe("READY");
    const reverse = await readNeedPreview(db, f.storeId, {
      ...input,
      productId: f.substitute.id,
      substituteProductId: f.product.id,
    });
    expect(reverse.status).toBe("NEEDS_INFORMATION");
    expect(reverse.basis.substitution).toBeNull();
    await db.collection("needUnits").updateOne({ _id: f.need.id } as Document, {
      $set: { status: "INACTIVE" },
    });
    expect((await readNeedPreview(db, f.storeId, input)).status).toBe(
      "BLOCKED",
    );
  });
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "commits one private need card with the reply and replays it after restart without a business declaration",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Renomme ce besoin client.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readNeedPreview(db, f.storeId, f.input);
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
        needPreviews: [preview],
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
      expect(readCopilotNeedProposal(payload).content.input.needUnitId).toBe(
        f.input.needUnitId,
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
      ).toBe(2);
    },
  );
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "rolls back reply and private artifacts when a need preview has forged scope",
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
      const preview = await readNeedPreview(db, f.storeId, f.input);
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
        needPreviews: [
          {
            ...preview,
            basis: {
              ...preview.basis,
              need: { ...preview.basis.need!, storeId: randomUUID() },
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
