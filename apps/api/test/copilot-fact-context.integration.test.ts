import { commercialExecutionFixture } from "../../../scripts/test-commercial-execution-fixtures";
import { readDailyAnalysis } from "../src/copilot/daily-analysis-tool";
import { readProductAnalysis } from "../src/copilot/product-analysis-tool";
import { readProductSearch } from "../src/copilot/product-search-tool";
import { readFieldEvents } from "../src/copilot/field-events-tool";
import { readCommercialPlan } from "../src/copilot/commercial-plan-tool";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { decisionFixture } from "../../../scripts/test-copilot-decision-fixtures";
import { actionReviewPerformance } from "../../../scripts/test-action-review-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { readPeriodAnalysis } from "../src/copilot/period-analysis-tool";
import {
  appendFactContext,
  readRecommendationContext,
  readTrackingWithFactContext,
  factReadFromTool,
} from "../src/copilot/fact-context";
import {
  CopilotAiError,
  type CopilotAiProvider,
} from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI,
  now = "2026-10-19T08:00:00.000Z";
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private recorded fact contexts",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_fact_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
    async function fixture(mode = "NORMAL", storeId?: string) {
      const f = decisionFixture(storeId ? { storeId } : undefined);
      const insert = (name: string, row: Document & { _id: string }) =>
        db.collection<Document & { _id: string }>(name).insertOne(row);
      await insert("copilotConversations", {
        _id: f.conversation.id,
        ...f.conversation,
      });
      await insert("copilotMessages", { _id: f.message.id, ...f.message });
      const productId = randomUUID();
      await insert("products", {
        _id: productId,
        storeId: f.storeId,
        label: "Tomates vrac",
      });
      const performance = actionReviewPerformance(
        f.storeId,
        productId,
        "2026-10-16",
        "100",
        "0",
      );
      await insert("productDailyPerformance", performance);
      const period = {
        productId,
        currentPeriod: { start: "2026-10-16", end: "2026-10-17" },
        referencePeriod: null,
        aggregation: "SUM",
        metrics: ["sales"],
      };
      const result = await readPeriodAnalysis(db, f.storeId, period);
      const trace = {
        reads: [factReadFromTool(JSON.stringify(["period", period]), result)!],
        complete: mode !== "INCOMPLETE",
      };
      if (mode === "INVALID") trace.reads[0]!.digest = "invalid";
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: f.source.text,
          facts: [],
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "fact-test",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: result.evidence,
        ...(mode === "LEGACY" ? {} : { factTrace: trace }),
      }));
      const deps = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: f.ownerId,
          canRespond: true,
        }),
        now: () => new Date(now),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: now,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
        replyId: f.source.id,
      };
      const scope = {
        storeId: f.storeId,
        ownerId: f.ownerId,
        conversationId: f.conversation.id,
      };
      return {
        ...f,
        productId,
        performance,
        trace,
        generate,
        deps,
        turn,
        scope,
      };
    }
    it("atomically captures real reply provenance, replays once and rechecks canonical facts without writing business data", async () => {
      const f = await fixture();
      const first = await runCopilotTurn(f.deps, f.turn);
      expect((await runCopilotTurn(f.deps, f.turn)).alreadyApplied).toBe(true);
      expect(f.generate).toHaveBeenCalledTimes(1);
      const row = await db
        .collection("copilotFactContexts")
        .findOne({ _id: f.source.id as never });
      expect(row).toMatchObject({
        storeId: f.storeId,
        ownerId: f.ownerId,
        complete: true,
      });
      expect(
        await db
          .collection("copilotFactContexts")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      const before = await db
        .collection("syncChanges")
        .countDocuments({ storeId: f.storeId });
      const r = await readRecommendationContext(db, f.scope, f.input, now);
      expect(r).toMatchObject({
        status: "UNCHANGED",
        checkedCount: 2,
        unavailableCount: 0,
      });
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(before);
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await appendFactContext(
            db,
            session,
            first.message,
            f.trace,
            [],
            false,
          );
        });
      } finally {
        await session.endSession();
      }
      expect(
        await db
          .collection("copilotFactContexts")
          .findOne({ _id: f.source.id as never }),
      ).toEqual(row);
    }, 60000);
    it("invalidates changed canonical figures and blocks a newly prepared tracking card without touching retained history", async () => {
      const f = await fixture();
      await runCopilotTurn(f.deps, f.turn);
      const old = await db
        .collection("copilotMessages")
        .findOne({ _id: f.source.id as never });
      await db
        .collection("productDailyPerformance")
        .updateOne(
          { _id: f.performance._id as never },
          { $set: { "performance.sales.salesValue": "101" } },
        );
      expect(
        await readRecommendationContext(db, f.scope, f.input, now),
      ).toMatchObject({ status: "STALE", changed: ["PERIOD"] });
      expect(
        (await readTrackingWithFactContext(db, f.scope, f.input)).status,
      ).toBe("STALE");
      expect(
        await db
          .collection("copilotMessages")
          .findOne({ _id: f.source.id as never }),
      ).toEqual(old);
    }, 60000);
    it.each(["OWNER", "STORE", "CONVERSATION", "HIDDEN"])(
      "keeps recorded contexts private and respects source visibility (%s)",
      async (mode) => {
        const f = await fixture();
        await runCopilotTurn(f.deps, f.turn);
        const scope = { ...f.scope };
        if (mode === "OWNER") scope.ownerId = randomUUID();
        if (mode === "STORE") scope.storeId = randomUUID();
        if (mode === "CONVERSATION") scope.conversationId = randomUUID();
        if (mode === "HIDDEN")
          await db
            .collection("copilotConversations")
            .updateOne(
              { _id: f.conversation.id as never },
              { $set: { deletedMessageIds: [f.source.id] } },
            );
        const r = await readRecommendationContext(db, scope, f.input, now);
        expect(r).toMatchObject({
          status: "SOURCE_UNAVAILABLE",
          checkedCount: 0,
        });
        expect(JSON.stringify(r.evidence)).not.toContain("100");
      },
      60000,
    );
    it.each(["LEGACY", "INCOMPLETE"])(
      "never declares an incompletely captured response current (%s)",
      async (mode) => {
        const f = await fixture(mode);
        await runCopilotTurn(f.deps, f.turn);
        expect(
          (await readRecommendationContext(db, f.scope, f.input, now)).status,
        ).toBe("UNVERIFIABLE");
        if (mode === "LEGACY")
          expect(
            await db
              .collection("copilotFactContexts")
              .countDocuments({ storeId: f.storeId }),
          ).toBe(0);
      },
      60000,
    );
    it("rolls the reply and sync event back when provenance cannot be committed", async () => {
      const f = await fixture("INVALID");
      await expect(runCopilotTurn(f.deps, f.turn)).rejects.toThrow();
      expect(
        await db
          .collection("copilotMessages")
          .findOne({ _id: f.source.id as never }),
      ).toBeNull();
      expect(
        await db
          .collection("copilotFactContexts")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 60000);
    it.each(["DAILY", "PRODUCT_CHANGES", "PRODUCT_SEARCH", "EVENTS", "PLAN"])(
      "replays canonical %s reads and detects a changed source",
      async (kind) => {
        const g = await commercialExecutionFixture();
        const f = await fixture("NORMAL", g.storeId);
        const inputs = {
          DAILY: { businessDate: "2026-10-16" },
          PRODUCT_CHANGES: {
            businessDate: "2026-10-16",
            metric: "sales",
            direction: "INCREASE",
          },
          PRODUCT_SEARCH: { label: "Tomate", identifiers: [] },
          EVENTS: {
            productId: f.productId,
            startAt: "2026-10-15T22:00:00.000Z",
            endAt: "2026-10-17T22:00:00.000Z",
            afterId: null,
            limit: 5,
          },
          PLAN: { weekStart: g.plan.weekStart, offset: 0, limit: 5 },
        };
        const input = inputs[kind as keyof typeof inputs];
        const readers = {
          DAILY: readDailyAnalysis,
          PRODUCT_CHANGES: readProductAnalysis,
          PRODUCT_SEARCH: readProductSearch,
          EVENTS: readFieldEvents,
          PLAN: readCommercialPlan,
        };
        const reader = readers[kind as keyof typeof readers];
        const value = await reader(db, f.storeId, input);
        const key =
          kind === "DAILY"
            ? ["daily", inputs.DAILY.businessDate]
            : kind === "PRODUCT_CHANGES"
              ? [
                  "products",
                  inputs.PRODUCT_CHANGES.businessDate,
                  "sales",
                  "INCREASE",
                ]
              : [
                  kind === "PRODUCT_SEARCH"
                    ? "product-search"
                    : kind === "PLAN"
                      ? "commercial-plan"
                      : "events",
                  input,
                ];
        f.trace.reads = [factReadFromTool(JSON.stringify(key), value)!];
        await runCopilotTurn(f.deps, f.turn);
        expect(
          (await readRecommendationContext(db, f.scope, f.input, now)).status,
        ).toBe("UNCHANGED");
        const collection = (name: string) =>
          db.collection<Document & { _id: string }>(name);
        if (kind === "DAILY") {
          const { productId, ...p } = actionReviewPerformance(
            f.storeId,
            f.productId,
            "2026-10-16",
            "100",
            "0",
          );
          void productId;
          await collection("departmentDailyPerformance").insertOne({
            ...p,
            performance: {
              ...p.performance,
              formulaVersion: "department-daily-v1",
            },
          });
        }
        if (kind === "PRODUCT_CHANGES")
          await collection("productDailyPerformance").insertOne(
            actionReviewPerformance(
              f.storeId,
              f.productId,
              "2026-10-09",
              "50",
              "0",
            ),
          );
        if (kind === "PRODUCT_SEARCH")
          await collection("products").insertOne({
            _id: g.product.id,
            ...g.product,
            storeId: f.storeId,
            createdAt: new Date(g.product.createdAt),
            updatedAt: new Date(g.product.updatedAt),
            deletedAt: null,
          });
        if (kind === "PLAN")
          await collection("commercialWeekPlans").insertOne({
            _id: g.plan.id,
            ...g.plan,
            storeId: f.storeId,
          });
        if (kind === "EVENTS") {
          const id = randomUUID();
          await collection("storeProductEvents").insertOne({
            _id: id,
            id,
            storeId: f.storeId,
            productId: f.productId,
            type: "OUT_OF_STOCK",
            startedAt: "2026-10-16T08:00:00.000Z",
            endedAt: "2026-10-16T12:00:00.000Z",
            severity: null,
            comment: "Observation",
            clientCapturedAt: now,
            source: "USER",
            sourceDocumentId: null,
            status: "CLOSED",
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
        await reader(db, f.storeId, input);
        const r = await readRecommendationContext(db, f.scope, f.input, now);
        expect(r.status).toBe("STALE");
        expect(r.changed).toContain(kind);
      },
      60000,
    );
    it("persists an outage reply once, reports its safe cause, and preserves the request without unrelated daily facts", async () => {
      const f = await fixture();
      f.generate.mockRejectedValueOnce(
        new CopilotAiError("COPILOT_AI_TIMEOUT", true),
      );
      const onGenerationFailure = vi.fn();
      const deps = { ...f.deps, onGenerationFailure };
      const first = await runCopilotTurn(deps, f.turn);
      const replay = await runCopilotTurn(deps, f.turn);
      expect(first.alreadyApplied).toBe(false);
      expect(replay).toEqual({ message: first.message, alreadyApplied: true });
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(onGenerationFailure).toHaveBeenCalledTimes(1);
      expect(onGenerationFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "GENERATION",
          code: "COPILOT_AI_TIMEOUT",
          retryable: true,
        }),
      );
      expect(first.message.text).toContain("réessayer");
      expect(first.message.text).not.toContain("100");
      expect(first.message.text).not.toContain("COPILOT_AI_TIMEOUT");
      expect(
        await db
          .collection("copilotMessages")
          .countDocuments({ _id: f.message.id as never }),
      ).toBe(1);
      expect(
        await db
          .collection("copilotMessages")
          .countDocuments({ _id: f.turn.replyId as never }),
      ).toBe(1);
      expect(
        await db
          .collection("copilotFactContexts")
          .countDocuments({ _id: f.turn.replyId as never }),
      ).toBe(0);
      expect(
        await db
          .collection("productDailyPerformance")
          .findOne({ _id: f.performance._id as never }),
      ).toEqual(f.performance);
    }, 60000);
  },
);
