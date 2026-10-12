import { readLatestDepartmentEvidence } from "../src/copilot/daily-evidence";
import { buildDepartmentDailyPerformance } from "@fl-copilot/analytics-core";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { appendCopilotResponse } from "../src/copilot/response-store";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import { acquireTurnLease } from "../src/copilot/turn-lease";
import { runCopilotTurn } from "../src/copilot/turn-service";
import {
  CopilotAiError,
  type CopilotAiProvider,
} from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "assistant response transactions",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db(
        `fl_reply_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      for (const name of [
        "copilotConversations",
        "copilotMessages",
        "syncStoreCounters",
        "syncChanges",
      ])
        await db.createCollection(name);
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    async function fixture() {
      const f = chatFixture(randomUUID);
      await db
        .collection<{ _id: string }>("copilotConversations")
        .insertOne({ _id: f.conversation.id, ...f.conversation });
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: f.message.id, ...f.message });
      const message = {
        ...f.message,
        id: randomUUID(),
        role: "ASSISTANT" as const,
        text: "Réponse testée",
        attachments: [],
        replyToMessageId: f.message.id,
      };
      return {
        ...f,
        response: message,
        authority: { storeId: f.storeId, ownerId: f.ownerId, canRespond: true },
      };
    }
    it("rolls back both reply and change, then persists exactly once across retry", async () => {
      const f = await fixture(),
        session = client.startSession(),
        changes = createMongoSyncChangeService();
      try {
        await expect(
          session.withTransaction(async () => {
            await appendCopilotResponse(
              { database: db, session },
              f.authority,
              f.response,
              changes,
            );
            throw new Error("injected rollback");
          }),
        ).rejects.toThrow("injected rollback");
        expect(
          await db
            .collection<{ _id: string }>("copilotMessages")
            .findOne({ _id: f.response.id }),
        ).toBeNull();
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(0);
        const first = await session.withTransaction(() =>
          appendCopilotResponse(
            { database: db, session },
            f.authority,
            f.response,
            changes,
          ),
        );
        expect(first!.alreadyApplied).toBe(false);
        const retry = await session.withTransaction(() =>
          appendCopilotResponse(
            { database: db, session },
            f.authority,
            f.response,
            changes,
          ),
        );
        expect(retry!.alreadyApplied).toBe(true);
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
        await expect(
          session.withTransaction(() =>
            appendCopilotResponse(
              { database: db, session },
              { ...f.authority, canRespond: false },
              f.response,
              changes,
            ),
          ),
        ).rejects.toThrow("COPILOT_REPLY_ACCESS_INVALID");
      } finally {
        await session.endSession();
      }
    });
    it("concurrent retries commit one reply and one change", async () => {
      const f = await fixture(),
        changes = createMongoSyncChangeService();
      const sessions = [client.startSession(), client.startSession()];
      try {
        const results = await Promise.all(
          sessions.map((session) =>
            session.withTransaction(() =>
              appendCopilotResponse(
                { database: db, session },
                f.authority,
                f.response,
                changes,
              ),
            ),
          ),
        );
        expect(results.filter((r) => !r!.alreadyApplied)).toHaveLength(1);
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
      } finally {
        await Promise.all(sessions.map((session) => session.endSession()));
      }
    });
    it("runs generation outside transaction and restores persisted reply without a second provider call", async () => {
      const f = await fixture();
      const generate = vi
        .fn()
        .mockRejectedValue(
          new CopilotAiError("COPILOT_AI_NOT_CONFIGURED", false),
        );
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      const authorize = vi.fn(async () => f.authority);
      const loadContext = vi.fn(async () => context);
      const dependencies = {
        db,
        provider: { model: null, generate } as CopilotAiProvider,
        authorize,
        loadContext,
      };
      const input = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
      };
      const first = await runCopilotTurn(dependencies, input);
      expect(first.alreadyApplied).toBe(false);
      const retry = await runCopilotTurn(dependencies, input);
      expect(retry).toEqual({ message: first.message, alreadyApplied: true });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(loadContext).toHaveBeenCalledTimes(1);
      await expect(
        runCopilotTurn(
          {
            ...dependencies,
            authorize: async () => ({ ...f.authority, canRespond: false }),
          },
          input,
        ),
      ).rejects.toThrow("ACCESS_INVALID");
      const controller = new AbortController();
      controller.abort();
      await expect(
        runCopilotTurn(dependencies, input, controller.signal),
      ).rejects.toThrow("CANCELLED");
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ entityId: input.replyId }),
      ).toBe(1);
    });
    it("blocks concurrent turn generation and allows retry after completion", async () => {
      const f = await fixture();
      const generate = vi
        .fn()
        .mockRejectedValue(
          new CopilotAiError("COPILOT_AI_NOT_CONFIGURED", false),
        );
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      let release!: () => void, entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dependencies = {
        db,
        provider: { model: null, generate } as CopilotAiProvider,
        authorize: async () => f.authority,
        loadContext: async () => {
          entered();
          await hold;
          return context;
        },
      };
      const input = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
      };
      const first = runCopilotTurn(dependencies, input);
      await ready;
      try {
        await expect(runCopilotTurn(dependencies, input)).rejects.toThrow(
          "IN_PROGRESS",
        );
      } finally {
        release();
      }
      await first;
      expect(generate).toHaveBeenCalledTimes(1);
      expect((await runCopilotTurn(dependencies, input)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledTimes(1);
    });
    it("expired workers cannot commit after lease takeover", async () => {
      const f = await fixture();
      const identity = {
        replyId: f.response.id,
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
        storeId: f.storeId,
        ownerId: f.ownerId,
      };
      const old = await acquireTurnLease(db, identity);
      await db
        .collection<{ _id: string }>("copilotTurnLeases")
        .updateOne(
          { _id: identity.replyId },
          { $set: { expiresAt: new Date(0) } },
        );
      const current = await acquireTurnLease(db, identity);
      const session = client.startSession();
      try {
        await expect(
          session.withTransaction(() => old.fence(session)),
        ).rejects.toThrow("LEASE_EXPIRED");
        await old.release();
        await session.withTransaction(() => current.fence(session));
        await expect(
          acquireTurnLease(db, { ...identity, ownerId: randomUUID() }),
        ).rejects.toThrow("IDENTITY_CONFLICT");
      } finally {
        await session.endSession();
        await current.release();
      }
    });
    it("serves an authenticated turn through HTTP with real Mongo persistence and retry", async () => {
      const f = await fixture();
      const context = detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: f.message.createdAt,
          candidates: [],
        }),
        intents: [],
      });
      const auth = {
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        refreshSession: vi.fn(),
        logout: vi.fn(),
        authorizeStore: vi.fn(async () => ({
          storeId: f.storeId,
          userId: f.ownerId,
          deviceId: f.deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER",
        })),
      } as AuthService;
      const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
        database: {
          getDb: async () => db,
          checkHealth: async () => "connected",
          close: async () => {},
        },
        auth,
        copilotContext: async () => context,
      });
      const options = {
        method: "POST" as const,
        url: "/api/v1/copilot/turn",
        headers: { authorization: "Bearer test", "x-store-id": f.storeId },
        payload: {
          replyId: f.response.id,
          conversationId: f.conversation.id,
          userMessageId: f.message.id,
        },
      };
      let failure = "";
      app.addHook("onError", async (_request, _reply, error) => {
        failure = `${error.name}: ${error.message}`;
      });
      try {
        const first = await app.inject(options);
        expect(first.statusCode, failure).toBe(200);
        expect(first.json().message.replyToMessageId).toBe(f.message.id);
        const retry = await app.inject(options);
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual({
          message: first.json().message,
          alreadyApplied: true,
        });
        expect(
          await db
            .collection("syncChanges")
            .countDocuments({ entityId: f.response.id }),
        ).toBe(1);
      } finally {
        await app.close();
      }
    });
    it("reads scoped dated canonical evidence without converting missing values to zero", async () => {
      const storeId = randomUUID(),
        foreign = randomUUID();
      const performance = buildDepartmentDailyPerformance({
        storeId,
        businessDate: "2026-10-01",
        computedAt: "2026-10-02T12:00:00.000Z",
        productPerformances: [],
      });
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          performance: unknown;
        }>("departmentDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId,
          date: performance.date,
          performance,
        });
      await db
        .collection<{
          _id: string;
          storeId: string;
          date: string;
          performance: unknown;
        }>("departmentDailyPerformance")
        .insertOne({
          _id: randomUUID(),
          storeId: foreign,
          date: "2026-10-12",
          performance: { ...performance, storeId: foreign, date: "2026-10-12" },
        });
      const evidence = await readLatestDepartmentEvidence(db, storeId);
      expect(evidence).toHaveLength(6);
      expect(
        evidence
          .filter((e) => e.sourceType === "KPI")
          .every((e) => e.value === null),
      ).toBe(true);
      expect(evidence.every((e) => e.label.includes("2026-10-01"))).toBe(true);
      expect(await readLatestDepartmentEvidence(db, randomUUID())).toEqual([]);
    });
  },
);
