import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actionReviewFixture,
  actionReviewPerformance,
} from "../../../scripts/test-action-review-fixtures";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import {
  decisionFixture,
  decisionNativeFixture,
  saveDecision,
} from "../../../scripts/test-copilot-decision-fixtures";
import { readActionReview } from "../src/copilot/action-review-tool";
import { runMongoMigrations } from "../src/database/migrations";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI,
  now = "2026-10-18T12:00:00.000Z";
describe.skipIf(!uri)("scoped action outcome review", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(
      `fl_action_review_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    );
    await runMongoMigrations(db);
  }, 60000);
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  }, 60000);
  async function fixture() {
    const f = await actionReviewFixture();
    const insert = async (name: string, row: Document & { _id: string }) =>
      db.collection<Document & { _id: string }>(name).insertOne(row);
    await insert("commercialWeekPlans", { _id: f.plan.id, ...f.plan });
    await insert("commercialExecutionTasks", { _id: f.task.id, ...f.task });
    await insert("products", { _id: f.product.id, ...f.product });
    for (const [date, sales, waste] of [
      ["2026-10-01", "100", "5"],
      ["2026-10-08", "200", "0"],
      ["2026-10-11", "150", null],
    ])
      await insert(
        "productDailyPerformance",
        actionReviewPerformance(f.storeId, f.product.id, date!, sales!, waste!),
      );
    const event = {
      id: randomUUID(),
      storeId: f.storeId,
      productId: f.product.id,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-09T08:00:00.000Z",
      endedAt: "2026-10-09T12:00:00.000Z",
      severity: null,
      comment: "Rupture signalée",
      clientCapturedAt: now,
      source: "USER",
      sourceDocumentId: null,
      status: "CLOSED",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await insert("storeProductEvents", { _id: event.id, ...event });
    return { ...f, event, insert };
  }
  async function retainedChoice(f: Awaited<ReturnType<typeof fixture>>) {
    const n = await decisionNativeFixture(
      decisionFixture({ storeId: f.storeId }),
    );
    for (const message of [n.message, n.source, n.request, n.assistant, n.card])
      await f.insert("copilotMessages", { _id: message.id, ...message });
    await f.insert("copilotConversations", {
      _id: n.conversation.id,
      ...n.conversation,
    });
    const choice = (await saveDecision(n, "MODIFY")).decision!;
    n.db.db.close();
    await f.insert("copilotDecisions", { _id: choice.id, ...choice });
    return {
      ...n,
      choice,
      input: {
        ...f.input,
        decision: {
          recommendationId: choice.id,
          expectedVersion: choice.version,
        },
      },
    };
  }
  it("combines an owned retained choice with a separately selected saved task, without writing a relationship or changing shared data", async () => {
    const f = await fixture(),
      n = await retainedChoice(f);
    const r = await readActionReview(db, f.storeId, n.input, now, n.ownerId);
    expect(r.status).toBe("READY");
    expect(r.decisionContext?.entries[0]).toMatchObject({
      id: n.choice.id,
      latest: {
        type: "MODIFY",
        modifiedAction: "Tester sur une TG plus petite.",
      },
    });
    expect(r.task?.declaration).toEqual(f.task);
    expect(
      r.evidence.some(
        (e) => e.sourceId === n.choice.id && e.sourceType === "EVENT",
      ),
    ).toBe(true);
    expect(r.evidence[0]?.value).toContain("aucun lien durable");
    expect(
      r.duringComparison?.evidence.some(
        (e) => e.value === "200" && e.sourceType === "KPI",
      ),
    ).toBe(true);
    expect(
      await db
        .collection("copilotDecisions")
        .findOne({ _id: n.choice.id as never }),
    ).toEqual({ _id: n.choice.id, ...n.choice });
    expect(
      await db.collection("syncChanges").countDocuments({ storeId: f.storeId }),
    ).toBe(0);
  });
  it("does not reveal another user's choice or another store's choice, even with its exact UUID", async () => {
    const f = await fixture(),
      n = await retainedChoice(f);
    for (const scope of [
      { storeId: f.storeId, ownerId: randomUUID() },
      { storeId: randomUUID(), ownerId: n.ownerId },
    ]) {
      const r = await readActionReview(
        db,
        scope.storeId,
        n.input,
        now,
        scope.ownerId,
      );
      expect(r.status).toBe("DECISION_UNAVAILABLE");
      expect(r.decisionContext?.entries).toEqual([]);
      expect(r.task).toBeNull();
      expect(r.duringComparison).toBeNull();
      expect(JSON.stringify(r)).not.toContain(n.preview.basis.quote);
      expect(JSON.stringify(r)).not.toContain(
        n.choice.revisions[0]!.modifiedAction,
      );
    }
  });
  it("requires reconsulting a changed choice and qualifies an archived conversation as historical context", async () => {
    const f = await fixture(),
      n = await retainedChoice(f);
    const changed = await readActionReview(
      db,
      f.storeId,
      { ...n.input, decision: { ...n.input.decision, expectedVersion: 2 } },
      now,
      n.ownerId,
    );
    expect(changed.status).toBe("DECISION_CHANGED");
    expect(changed.duringComparison).toBeNull();
    await db
      .collection("copilotConversations")
      .updateOne(
        { _id: n.conversation.id as never },
        { $set: { status: "ARCHIVED" } },
      );
    const archived = await readActionReview(
      db,
      f.storeId,
      n.input,
      now,
      n.ownerId,
    );
    expect(archived.status).toBe("READY");
    expect(archived.decisionContext?.entries[0]?.sourceState).toBe(
      "INACTIVE_SOURCE",
    );
    expect(archived.decisionContext?.entries[0]?.latest.type).toBe("MODIFY");
    expect(archived.duringComparison).not.toBeNull();
    expect(archived.decisionContext?.evidence[0]?.value).toContain(
      "archivée ou retirée",
    );
    await db
      .collection("copilotMessages")
      .updateOne(
        { _id: n.source.id as never },
        { $set: { text: "Origine modifiée" } },
      );
    const invalid = await readActionReview(
      db,
      f.storeId,
      n.input,
      now,
      n.ownerId,
    );
    expect(invalid.status).toBe("DECISION_SOURCE_UNAVAILABLE");
    expect(invalid.task).toBeNull();
    expect(invalid.duringComparison).toBeNull();
  });
  it("retrieves scoped KPIs and recorded overlap through actual canonical readers, preserving plan/task data", async () => {
    const f = await fixture(),
      r = await readActionReview(db, f.storeId, f.input, now);
    expect(r.status).toBe("READY");
    expect(r.fieldEvents?.events.map((e) => e.event.id)).toEqual([f.event.id]);
    expect(r.task?.declaration?.completedAt).toBe(f.task.completedAt);
    expect(
      r.duringComparison?.evidence.find(
        (e) => e.sourceType === "KPI" && e.value === "200",
      ),
    ).toBeDefined();
    expect(
      (await readActionReview(db, randomUUID(), f.input, now)).status,
    ).toBe("NO_PLAN");
    expect(
      (
        await readActionReview(
          db,
          f.storeId,
          { ...f.input, productId: randomUUID() },
          now,
        )
      ).status,
    ).toBe("PRODUCT_NOT_IN_TASK");
    const plan = await db
      .collection("commercialWeekPlans")
      .findOne({ _id: f.plan.id as never });
    expect(plan?.version).toBe(f.plan.version);
    expect(
      await db
        .collection("commercialExecutionTasks")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(1);
    expect(
      await db.collection("syncChanges").countDocuments({ storeId: f.storeId }),
    ).toBe(0);
  });
  it("keeps five-event pages explicit and excludes foreign events and nonoverlapping boundary events", async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) {
      const id = randomUUID();
      await f.insert("storeProductEvents", { _id: id, ...f.event, id });
    }
    for (const change of [
      { storeId: randomUUID() },
      { productId: randomUUID() },
      { startedAt: "2026-10-13T22:00:00.000Z", endedAt: null },
      {
        startedAt: "2026-09-29T08:00:00.000Z",
        endedAt: "2026-09-30T22:00:00.000Z",
      },
    ]) {
      const id = randomUUID();
      await f.insert("storeProductEvents", {
        _id: id,
        ...f.event,
        id,
        ...change,
      });
    }
    const r = await readActionReview(db, f.storeId, f.input, now);
    expect(r.fieldEvents).toMatchObject({
      hasMore: true,
      startAt: "2026-09-30T22:00:00.000Z",
      endAt: "2026-10-13T22:00:00.000Z",
    });
    expect(r.fieldEvents?.events).toHaveLength(5);
    expect(
      r.fieldEvents?.events.every(
        (e) =>
          e.event.storeId === f.storeId &&
          e.event.productId === f.product.id &&
          e.event.startedAt === f.event.startedAt,
      ),
    ).toBe(true);
    expect(r.fieldEvents?.evidence.at(-1)?.value).toContain(
      "d’autres observations",
    );
  });
  it("respects Paris DST and missing after-period data without fabricating completion or zeros", async () => {
    const f = await fixture();
    await db
      .collection("commercialExecutionTasks")
      .deleteMany({ storeId: f.storeId });
    const r = await readActionReview(
      db,
      f.storeId,
      { ...f.input, after: { start: "2026-10-24", end: "2026-10-26" } },
      "2026-10-28T12:00:00.000Z",
    );
    expect(r.task?.declaration).toBeNull();
    expect(r.fieldEvents?.endAt).toBe("2026-10-26T23:00:00.000Z");
    expect(r.afterComparison?.coverage[0]?.current).toMatchObject({
      availableDays: 0,
      missingDays: 3,
    });
    expect(
      r.afterComparison?.evidence.some(
        (e) => e.sourceType === "KPI" && e.value === null,
      ),
    ).toBe(true);
    expect(r.evidence[0]?.value).toContain("réalisation inconnue");
  });
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "retains sourced review in private chat and replays once after restart without a business action",
    async () => {
      const f = await fixture(),
        n = await retainedChoice(f),
        r = await readActionReview(db, f.storeId, n.input, now, n.ownerId),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.ownerId = n.ownerId;
      chat.conversation.ownerId = n.ownerId;
      chat.message.ownerId = n.ownerId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "Fais le bilan de cette TG.";
      await f.insert("copilotConversations", {
        _id: chat.conversation.id,
        ...chat.conversation,
      });
      await f.insert("copilotMessages", {
        _id: chat.message.id,
        ...chat.message,
      });
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Le bilan reste descriptif.",
          narrative: "Le bilan reste descriptif. {{source:0}}",
          facts: [{ evidenceId: r.decisionContext!.evidence[0]!.id }],
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-action-review",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: r.evidence,
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
              evaluatedAt: now,
              candidates: [],
            }),
            intents: [],
          }),
        now: () => new Date(now),
      };
      const turn = {
        conversationId: chat.conversation.id,
        userMessageId: chat.message.id,
        replyId: randomUUID(),
      };
      const first = await runCopilotTurn(dependencies, turn);
      expect(first.message.text).toContain("copilot-source:");
      expect((await runCopilotTurn(dependencies, turn)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledOnce();
      expect(
        await db
          .collection("commercialExecutionTasks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await db.collection("copilotMessages").countDocuments({
          conversationId: chat.conversation.id,
          role: "ASSISTANT",
        }),
      ).toBe(1);
      await expect(
        runCopilotTurn(
          {
            ...dependencies,
            authorize: async () => ({
              storeId: f.storeId,
              ownerId: randomUUID(),
              canRespond: true,
            }),
          },
          turn,
        ),
      ).rejects.toThrow();
    },
  );
});
