import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actionReviewFixture,
  actionReviewPerformance,
} from "../../../scripts/test-action-review-fixtures";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
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
        r = await readActionReview(db, f.storeId, f.input, now),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
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
          facts: [{ evidenceId: r.evidence[0]!.id }],
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
