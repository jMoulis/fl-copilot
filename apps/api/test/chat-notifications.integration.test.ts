import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "../src/config";
import { buildApp } from "../src/build-app";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { createMongoAuthService } from "../src/auth/service";
import {
  updateDevicePushToken,
  registeredChatPush,
  notifyChatCompletion,
} from "../src/notifications/chat-completion";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "owned chat completion push on disposable transactional Mongo",
  () => {
    let database: DatabaseService, db: Db;
    const config = parseEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: uri,
      MONGODB_DATABASE: "fl_m8_push_" + randomUUID().replaceAll("-", ""),
      AUTH_DEVELOPMENT_CODE: "123456",
    });
    beforeAll(async () => {
      database = createMongoDatabase(config);
      db = await database.getDb();
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await database?.close();
      }
    });
    async function fixture() {
      const auth = createMongoAuthService(database, config, async () => {}),
        deviceId = randomUUID();
      const challenge = await auth.requestChallenge({
        deviceId,
        email: `${randomUUID()}@example.test`,
        platform: "IOS",
        appVersion: "test",
      });
      const session = await auth.verifyChallenge(
          challenge.challengeId,
          "123456",
        ),
        storeId = randomUUID();
      await db.collection("storeMemberships").insertOne({
        userId: session.user.id,
        storeId,
        storeName: "Push test",
        role: "MANAGER",
        active: true,
      });
      const principal = await auth.authorizeStore(
        session.accessToken,
        storeId,
        deviceId,
      );
      const f = chatFixture(randomUUID),
        conversation = {
          ...f.conversation,
          storeId,
          ownerId: principal.userId,
        };
      const reply = {
        ...f.message,
        id: randomUUID(),
        storeId,
        ownerId: principal.userId,
        conversationId: conversation.id,
        attachments: [],
        role: "ASSISTANT" as const,
        replyToMessageId: f.message.id,
      };
      await db
        .collection<{ _id: string }>("copilotConversations")
        .insertOne({ _id: conversation.id, ...conversation });
      await db
        .collection<{ _id: string }>("copilotMessages")
        .insertOne({ _id: reply.id, ...reply });
      const token = `ExpoPushToken[${randomUUID().replaceAll("-", "")}]`;
      const data = {
        kind: "COPILOT_REPLY_READY" as const,
        storeId,
        ownerId: principal.userId,
        conversationId: conversation.id,
        replyId: reply.id,
      };
      const send = vi.fn<typeof fetch>(async () =>
        Response.json({ data: { status: "ok", id: "synthetic-ticket" } }),
      );
      return {
        auth,
        deviceId,
        session,
        principal,
        storeId,
        conversation,
        reply,
        token,
        data,
        send,
      };
    }
    it("binds the canonical HTTP registration to the live device/store/session", async () => {
      const f = await fixture(),
        app = buildApp(config, { database, auth: f.auth });
      try {
        const request = (
          device = f.deviceId,
          headers = {
            authorization: `Bearer ${f.session.accessToken}`,
            "x-store-id": f.storeId,
          },
          token: string | null = f.token,
        ) =>
          app.inject({
            method: "PUT",
            url: `/api/v1/devices/${device}/push-token`,
            headers,
            payload: { storeId: f.storeId, pushToken: token },
          });
        expect(
          (
            await request(f.deviceId, {
              authorization: "",
              "x-store-id": f.storeId,
            })
          ).statusCode,
        ).toBe(401);
        expect((await request(randomUUID())).statusCode).toBe(403);
        expect(
          (
            await request(f.deviceId, {
              authorization: `Bearer ${f.session.accessToken}`,
              "x-store-id": randomUUID(),
            })
          ).statusCode,
        ).toBe(403);
        expect((await request()).json()).toEqual({ enabled: true });
        expect(await registeredChatPush(db, f.principal)).toBe(f.token);
        expect((await request(f.deviceId, undefined, null)).json()).toEqual({
          enabled: false,
        });
        expect(await registeredChatPush(db, f.principal)).toBeUndefined();
      } finally {
        await app.close();
      }
    });
    it("sends only identities with generic text after an actual persisted reply", async () => {
      const f = await fixture();
      await updateDevicePushToken(db, f.principal, f.deviceId, {
        storeId: f.storeId,
        pushToken: f.token,
      });
      await notifyChatCompletion(db, f.principal, f.data, { fetch: f.send });
      expect(f.send).toHaveBeenCalledTimes(1);
      const body = JSON.parse(f.send.mock.calls[0]![1]!.body as string);
      expect(body.data).toEqual(f.data);
      expect(JSON.stringify(body)).not.toContain(f.reply.text);
      expect(body.collapseId).toBe(f.reply.id);
      expect(f.send.mock.calls[0]![0]).toBe(
        "https://exp.host/--/api/v2/push/send",
      );
    });
    it.each([
      "logout",
      "membership",
      "conversation",
      "reply",
      "foreign",
      "absent",
    ])(
      "refuses a completion after %s invalidates authority or visibility",
      async (kind) => {
        const f = await fixture();
        await updateDevicePushToken(db, f.principal, f.deviceId, {
          storeId: f.storeId,
          pushToken: f.token,
        });
        if (kind === "logout") await f.auth.logout(f.session.accessToken);
        if (kind === "membership")
          await db
            .collection("storeMemberships")
            .updateOne(
              { userId: f.principal.userId, storeId: f.storeId },
              { $set: { active: false } },
            );
        if (kind === "conversation")
          await db
            .collection<{ _id: string }>("copilotConversations")
            .updateOne(
              { _id: f.conversation.id },
              {
                $set: {
                  status: "ARCHIVED",
                  deletedAt: "2026-11-05T00:00:00.000Z",
                  updatedAt: "2026-11-05T00:00:00.000Z",
                },
              },
            );
        if (kind === "reply")
          await db
            .collection<{ _id: string }>("copilotConversations")
            .updateOne(
              { _id: f.conversation.id },
              { $set: { deletedMessageIds: [f.reply.id] } },
            );
        const data =
          kind === "foreign"
            ? { ...f.data, ownerId: randomUUID() }
            : kind === "absent"
              ? { ...f.data, replyId: randomUUID() }
              : f.data;
        await notifyChatCompletion(db, f.principal, data, { fetch: f.send });
        expect(f.send).not.toHaveBeenCalled();
      },
    );
    it("transfers a device token without notifying a previous account and rolls back a stale registration", async () => {
      const a = await fixture(),
        b = await fixture();
      await updateDevicePushToken(db, a.principal, a.deviceId, {
        storeId: a.storeId,
        pushToken: a.token,
      });
      await b.auth.logout(b.session.accessToken);
      await expect(
        updateDevicePushToken(db, b.principal, b.deviceId, {
          storeId: b.storeId,
          pushToken: a.token,
        }),
      ).rejects.toThrow();
      expect(await registeredChatPush(db, a.principal)).toBe(a.token);
      const c = await fixture();
      await updateDevicePushToken(db, c.principal, c.deviceId, {
        storeId: c.storeId,
        pushToken: a.token,
      });
      expect(await registeredChatPush(db, a.principal)).toBeUndefined();
      expect(await registeredChatPush(db, c.principal)).toBe(a.token);
    });
    it("retires an invalid provider token without affecting the persisted answer", async () => {
      const f = await fixture();
      await updateDevicePushToken(db, f.principal, f.deviceId, {
        storeId: f.storeId,
        pushToken: f.token,
      });
      f.send.mockResolvedValueOnce(
        Response.json({
          data: { status: "error", details: { error: "DeviceNotRegistered" } },
        }),
      );
      await notifyChatCompletion(db, f.principal, f.data, { fetch: f.send });
      expect(await registeredChatPush(db, f.principal)).toBeUndefined();
      expect(
        await db
          .collection<{ _id: string }>("copilotMessages")
          .countDocuments({ _id: f.reply.id }),
      ).toBe(1);
    });

    it("keeps delivery registration through refresh but never inherits it on verified re-login", async () => {
      const f = await fixture();
      await updateDevicePushToken(db, f.principal, f.deviceId, {
        storeId: f.storeId,
        pushToken: f.token,
      });
      const refreshed = await f.auth.refreshSession(
        f.deviceId,
        f.session.refreshToken,
      );
      expect(
        await registeredChatPush(
          db,
          await f.auth.authorizeStore(refreshed.accessToken, f.storeId),
        ),
      ).toBe(f.token);
      const challenge = await f.auth.requestChallenge({
        deviceId: f.deviceId,
        email: f.session.user.email,
        platform: "IOS",
        appVersion: "test",
      });
      const next = await f.auth.verifyChallenge(
        challenge.challengeId,
        "123456",
      );
      expect(await registeredChatPush(db, f.principal)).toBeUndefined();
      expect(
        await registeredChatPush(
          db,
          await f.auth.authorizeStore(next.accessToken, f.storeId),
        ),
      ).toBeUndefined();
    });

    it("a partial unique index fences concurrent claims of the same OS token", async () => {
      const a = await fixture(),
        b = await fixture();
      const attempts = await Promise.allSettled([
        updateDevicePushToken(db, a.principal, a.deviceId, {
          storeId: a.storeId,
          pushToken: a.token,
        }),
        updateDevicePushToken(db, b.principal, b.deviceId, {
          storeId: b.storeId,
          pushToken: a.token,
        }),
      ]);
      expect(attempts.some((r) => r.status === "fulfilled")).toBe(true);
      expect(
        await db
          .collection("deviceSessions")
          .countDocuments({ "push.token": a.token }),
      ).toBe(1);
      for (const attempt of attempts)
        if (attempt.status === "rejected")
          expect(String(attempt.reason)).not.toContain(a.token);
    });
  },
);
