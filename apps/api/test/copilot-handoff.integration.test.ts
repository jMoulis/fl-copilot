import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/service";
import { AuthError } from "../src/auth/service";
import type { Db } from "mongodb";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import { createMongoSyncPushService } from "../src/sync/push-service";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { notifyChatCompletion } from "../src/notifications/chat-completion";
vi.mock("../src/notifications/chat-completion", async (original) => ({
  ...(await original<object>()),
  registeredChatPush: vi.fn(async () => "test-registered-token"),
  notifyChatCompletion: vi.fn(async () => {}),
}));
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "canonical handoff on isolated transactional Mongo",
  () => {
    const config = parseEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: uri,
      MONGODB_DATABASE: "fl_m8_handoff_" + randomUUID().replaceAll("-", ""),
    });
    const database = createMongoDatabase(config);
    let db: Db;
    beforeAll(async () => {
      db = await database.getDb();
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await database.close();
      }
    });
    async function fixture(gated = false) {
      const f = chatFixture(randomUUID),
        message = { ...f.message, attachments: [] };
      const ids = {
        conversationId: f.conversation.id,
        userMessageId: message.id,
        replyId: randomUUID(),
      };
      const packet = {
        syncProtocolVersion: 1 as const,
        appVersion: "test",
        storeId: f.storeId,
        deviceId: f.deviceId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "COPILOT_CONVERSATION_UPSERT",
            entityType: "copilot_conversation",
            entityId: f.conversation.id,
            expectedRemoteVersion: null,
            createdAt: message.createdAt,
            payload: f.conversation,
          },
          {
            commandId: randomUUID(),
            localSequence: 2,
            type: "COPILOT_MESSAGE_APPEND",
            entityType: "copilot_message",
            entityId: message.id,
            expectedRemoteVersion: null,
            createdAt: message.createdAt,
            payload: message,
          },
        ],
      };
      let entered!: () => void, finish!: () => void;
      const committed = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const push = createMongoSyncPushService(database);
      const tasks: Promise<void>[] = [];
      const auth = {
        authorizeStore: vi.fn(
          async (_token: string, store: string, device?: string) => {
            if (store !== f.storeId || (device && device !== f.deviceId))
              throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé.");
            return {
              userId: f.ownerId,
              storeId: f.storeId,
              deviceId: f.deviceId,
              sessionId: randomUUID(),
              storeName: "test",
              role: "MANAGER" as const,
            };
          },
        ),
      } as unknown as AuthService;
      const app = buildApp(config, {
        database: { ...database, close: async () => {} },
        auth,
        waitUntil: (task) => {
          tasks.push(task);
        },
        copilotContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: message.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
        syncPush: {
          push: async (...args) => {
            const result = await push.push(...args);
            entered();
            if (gated) await gate;
            return result;
          },
        },
      });
      const headers = {
        authorization: "Bearer test-only",
        "x-store-id": f.storeId,
        "x-commercial-source-version": "2",
        "x-sync-protocol-version": "1",
        "x-copilot-background-completion": "1",
        "x-copilot-activity": "1",
        accept: "application/x-ndjson",
        "content-type": "application/json",
      };
      return { f, app, ids, packet, headers, tasks, committed, finish };
    }
    it("finishes from one accepted request after the client disappears during intake, then ordinary sync replays without duplicates", async () => {
      const x = await fixture(true);
      const address = await x.app.listen({ port: 0, host: "127.0.0.1" });
      const controller = new AbortController();
      const result = fetch(address + "/api/v1/copilot/turn", {
        method: "POST",
        headers: x.headers,
        body: JSON.stringify({ ...x.ids, synchronization: x.packet }),
        signal: controller.signal,
      }).catch(() => undefined);
      try {
        await x.committed;
        expect(x.tasks).toHaveLength(1);
        controller.abort();
        await result;
        x.finish();
        await Promise.all(x.tasks);
        expect(
          await db.collection("copilotMessages").countDocuments({
            conversationId: x.ids.conversationId,
            role: "ASSISTANT",
          }),
        ).toBe(1);
        expect(
          vi
            .mocked(notifyChatCompletion)
            .mock.calls.filter((call) => call[2].replyId === x.ids.replyId),
        ).toHaveLength(1);
        const replay = await x.app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers: x.headers,
          payload: x.packet,
        });
        expect(replay.statusCode).toBe(200);
        expect(
          replay.json().results.map((row: { status: string }) => row.status),
        ).toEqual(["ALREADY_APPLIED", "ALREADY_APPLIED"]);
        await x.app.inject({
          method: "POST",
          url: "/api/v1/copilot/turn",
          headers: x.headers,
          payload: { ...x.ids, synchronization: x.packet },
        });
        await Promise.all(x.tasks);
        expect(
          await db
            .collection<{ _id: string }>("copilotMessages")
            .countDocuments({ _id: x.ids.replyId }),
        ).toBe(1);
        expect(
          vi
            .mocked(notifyChatCompletion)
            .mock.calls.filter((call) => call[2].replyId === x.ids.replyId),
        ).toHaveLength(1);
      } finally {
        x.finish();
        x.app.server.closeAllConnections();
        await x.app.close();
      }
    });
    it.each(["owner", "device"])(
      "does not generate from a forged %s",
      async (mode) => {
        const x = await fixture();
        if (mode === "owner")
          for (const command of x.packet.commands)
            command.payload.ownerId = randomUUID();
        else x.packet.deviceId = randomUUID();
        try {
          const response = await x.app.inject({
            method: "POST",
            url: "/api/v1/copilot/turn",
            headers: x.headers,
            payload: { ...x.ids, synchronization: x.packet },
          });
          await Promise.all(x.tasks);
          expect(response.statusCode).toBe(mode === "owner" ? 409 : 403);
          expect(
            await db.collection("copilotMessages").countDocuments({
              conversationId: x.ids.conversationId,
              role: "ASSISTANT",
            }),
          ).toBe(0);
        } finally {
          x.app.server.closeAllConnections();
          await x.app.close();
        }
      },
    );
  },
);
