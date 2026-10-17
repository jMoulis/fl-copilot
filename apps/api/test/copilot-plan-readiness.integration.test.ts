import { previewCommercialPlanValidation } from "../src/copilot/plan-validation-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { readCopilotPlanValidationProposal } from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { vi } from "vitest";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialPlanFixture } from "../../../scripts/test-commercial-plan-fixtures";
import { readCommercialPlanReadiness } from "../src/copilot/plan-readiness-tool";
import { validatePlanReadinessResult } from "@fl-copilot/domain";
import { runMongoMigrations } from "../src/database/migrations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("complete synchronized commercial plan readiness", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_ready_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  const input = { weekStart: "2026-10-05" };
  async function fixture() {
    const f = await commercialPlanFixture();
    for (const [name, value] of [
      ["commercialWeekPreparations", f.preparation],
      ["commercialOfferChoices", { ...f.choice, duplicateKey: randomUUID() }],
      [
        "products",
        {
          ...f.product,
          schemaVersion: 1,
          packaging: null,
          createdAt: new Date(f.product.createdAt),
          updatedAt: new Date(f.product.updatedAt),
        },
      ],
      ["commercialVisualReadings", f.reading],
      ["commercialValidatedOffers", f.validated],
    ] as const)
      await db
        .collection<Document & { _id: string }>(name)
        .insertOne({ _id: value.id, ...value });
    return f;
  }
  it("reuses canonical complete readiness without saving a plan, action, or Outbox", async () => {
    const f = await fixture();
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(validatePlanReadinessResult(f.storeId, input, r)).toEqual(r);
    expect(r.status).toBe("READY");
    expect(r.issues).toEqual([]);
    expect(r.preparation).toMatchObject({
      id: f.preparation.id,
      selectedOfferCount: 1,
      placementCount: 1,
    });
    for (const name of [
      "commercialWeekPlans",
      "commercialExecutionTasks",
      "syncChanges",
      "commercialPlanHistory",
    ])
      expect(
        await db.collection(name).countDocuments({ storeId: f.storeId }),
      ).toBe(0);
  });
  it("reports missing validations, inactive products, source changes and empty TGs precisely", async () => {
    const f = await fixture();
    await db
      .collection("commercialValidatedOffers")
      .deleteMany({ storeId: f.storeId });
    await db
      .collection("products")
      .updateOne({ _id: f.product.id } as Document, {
        $set: { status: "RETIRED" },
      });
    await db
      .collection("commercialVisualReadings")
      .updateOne({ _id: f.reading.id } as Document, {
        $set: { checksum: "different" },
      });
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { "placements.0.offerIds": [] },
      });
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("BLOCKED");
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "NOT_VALIDATED",
        "PRODUCT_INVALID",
        "SOURCE_INVALID",
        "EMPTY_TG",
      ]),
    );
    expect(r.issues.find((i) => i.code === "NOT_VALIDATED")).toMatchObject({
      choiceId: f.choice.id,
      label: f.choice.rawProductLabel,
    });
    expect(r.issues.find((i) => i.code === "EMPTY_TG")).toMatchObject({
      placementId: f.preparation.placements[0]!.id,
      label: "TG entrée",
    });
  });
  it("isolates week/store and never treats absence as ready or foreign data as dependencies", async () => {
    const f = await fixture();
    expect(
      (await readCommercialPlanReadiness(db, randomUUID(), input)).status,
    ).toBe("NO_DRAFT");
    expect(
      (
        await readCommercialPlanReadiness(db, f.storeId, {
          weekStart: "2026-10-12",
        })
      ).status,
    ).toBe("NO_DRAFT");
    await db
      .collection("products")
      .updateOne({ _id: f.product.id } as Document, {
        $set: { storeId: randomUUID() },
      });
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("BLOCKED");
    expect(r.issues.map((i) => i.code)).toContain("PRODUCT_INVALID");
  });
  it("detects incompatible price units and changed retained choices without refreshing them", async () => {
    const f = await fixture();
    await db
      .collection("products")
      .updateOne({ _id: f.product.id } as Document, {
        $set: { salesUnit: "PIECE" },
      });
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, { $set: { version: 2 } });
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("BLOCKED");
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["CHANGED", "UNIT_MISMATCH"]),
    );
    expect(
      (
        await db
          .collection("commercialWeekPreparations")
          .findOne({ _id: f.preparation.id } as Document)
      )?.offerRefs[0].choiceVersion,
    ).toBe(1);
  });
  it("returns unknown readiness rather than checking only a sample of reference decisions", async () => {
    const f = await fixture();
    const base = {
      id: randomUUID(),
      storeId: f.storeId,
      before: { documentId: f.sourceDocumentId },
      after: { documentId: randomUUID() },
    };
    // Sentinel rows need not be parsed: exceeding the limit fails closed first.
    await db
      .collection<Document & { _id: string }>("commercialVersionDecisions")
      .insertMany(
        Array.from({ length: 201 }, () => ({
          ...base,
          id: randomUUID(),
          _id: randomUUID(),
        })),
      );
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.issues).toEqual([]);
  });
  it("does not present a truncated oversized issue list as a complete review", async () => {
    const f = await fixture();
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: {
          offerRefs: Array.from({ length: 100 }, () => ({
            choiceId: randomUUID(),
            choiceVersion: 1,
          })),
          placements: [],
        },
      });
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.issues).toEqual([]);
    expect(r.preparation?.selectedOfferCount).toBe(100);
  });
  it("checks PDF idea references on TGs as well as selected offer sources", async () => {
    const f = await fixture();
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: {
          "placements.0.sourceIdea": {
            readingId: randomUUID(),
            checksum: f.reading.checksum,
            tgIndex: 0,
          },
        },
      });
    const r = await readCommercialPlanReadiness(db, f.storeId, input);
    expect(r.status).toBe("BLOCKED");
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SOURCE_IDEA_INVALID",
          placementId: f.preparation.placements[0]!.id,
        }),
      ]),
    );
  });
  it("prepares a complete deterministic plan and suppresses an unchanged saved plan", async () => {
    const f = await fixture(),
      result = await previewCommercialPlanValidation(
        db,
        f.storeId,
        input,
        () => "2026-10-11T12:00:00.000Z",
      );
    expect(result.status).toBe("READY");
    expect(result.preview?.candidate?.preparation).toEqual(f.preparation);
    expect(
      await db
        .collection("commercialWeekPlans")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    await db
      .collection<Document & { _id: string }>("commercialWeekPlans")
      .insertOne({ _id: f.plan.id, ...f.plan });
    const repeat = await previewCommercialPlanValidation(db, f.storeId, input);
    expect(repeat.status).toBe("UNCHANGED");
    expect(repeat.preview).toBeNull();
    await db
      .collection("commercialValidatedOffers")
      .deleteMany({ storeId: f.storeId });
    const blocked = await previewCommercialPlanValidation(db, f.storeId, input);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.preview).toBeNull();
  });
  it("refuses an oversized complete plan card without dropping offers or TGs", async () => {
    const f = await fixture();
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: {
          tgCapacity: 30,
          placements: Array.from({ length: 30 }, (_, i) => ({
            ...f.preparation.placements[0]!,
            id: randomUUID(),
            label: `TG ${i} ` + "x".repeat(70),
            theme: "x".repeat(240),
          })),
        },
      });
    const result = await previewCommercialPlanValidation(db, f.storeId, input);
    expect(result.status).toBe("LIMIT_EXCEEDED");
    expect(result.preview).toBeNull();
  });
  it
    .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
    .each([false, true])(
    "persists plan cards atomically and rejects foreign candidates (%s)",
    async (foreign) => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Je veux valider le plan de la semaine.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await previewCommercialPlanValidation(
          db,
          f.storeId,
          input,
        ),
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
          planValidations: [
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
      expect(
        readCopilotPlanValidationProposal(card).content.preview.candidate
          ?.preparation,
      ).toEqual(f.preparation);
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
