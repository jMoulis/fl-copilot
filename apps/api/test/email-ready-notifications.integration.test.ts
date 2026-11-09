import { randomUUID } from "node:crypto";
import type { Db, Document, CollectionOptions } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { createEmailIntakeStore } from "../src/intake/email-intake-store";
import { notifyEmailReady } from "../src/notifications/email-ready";
import {
  updateDevicePushToken,
  registeredChatPush,
} from "../src/notifications/chat-completion";
import type { AuthorizedStoreContext } from "../src/auth/service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "owned store email ready alerts",
  () => {
    let database: DatabaseService, db: Db;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_email_push_${randomUUID().replaceAll("-", "")}`,
        }),
      );
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
      const storeId = randomUUID(),
        ownerId = randomUUID(),
        receiptId = randomUUID(),
        bindingId = randomUUID(),
        sessionId = randomUUID(),
        deviceId = randomUUID(),
        token = `ExpoPushToken[${randomUUID().replaceAll("-", "")}]`;
      const principal = {
        storeId,
        userId: ownerId,
        sessionId,
        deviceId,
      } as AuthorizedStoreContext;
      await db
        .collection("storeMemberships")
        .insertOne({ storeId, userId: ownerId, role: "MANAGER", active: true });
      const receipts = db.collection<Document & { _id: string }>(
          "emailIntakeReceipts",
        ),
        sessions = db.collection<Document & { _id: string }>("deviceSessions"),
        bindings = db.collection<Document & { _id: string }>(
          "emailIntakeBindings",
        );
      await createEmailIntakeStore(database, "unit.resend.app").createBinding(
        { storeId, ownerId },
        {
          id: bindingId,
          conversationId: storeId,
          allowedSender: "manager@example.test",
        },
      );
      await receipts.insertOne({
        _id: receiptId,
        providerEmailId: randomUUID(),
        storeId,
        ownerId,
        conversationId: storeId,
        bindingId,
        status: "AWAITING_CONFIRMATION",
        version: 1,
        files: [
          { id: randomUUID(), status: "READY" },
          { id: randomUUID(), status: "PENDING" },
        ],
      });
      await sessions.insertOne({
        _id: sessionId,
        userId: ownerId,
        deviceId,
        expiresAt: new Date(Date.now() + 3600000),
      });
      const send = vi.fn<typeof fetch>(async () =>
        Response.json({ data: { status: "ok" } }),
      );
      const ready = () =>
        receipts.updateOne(
          { _id: receiptId },
          { $set: { "files.1.status": "READY" }, $inc: { version: 1 } },
        );
      const enable = (channels = { chat: false, email: true }) =>
        updateDevicePushToken(db, principal, deviceId, {
          storeId,
          pushToken: token,
          channels,
        });
      return {
        storeId,
        ownerId,
        receiptId,
        bindingId,
        sessionId,
        deviceId,
        token,
        principal,
        receipts,
        sessions,
        bindings,
        send,
        ready,
        enable,
        notify: () => notifyEmailReady(db, receiptId, { fetch: send }),
      };
    }
    it("waits for the whole envelope, then claims once under concurrent finishes and retries", async () => {
      const f = await fixture();
      await f.enable();
      await f.notify();
      expect(f.send).not.toHaveBeenCalled();
      await f.ready();
      await Promise.all([f.notify(), f.notify(), f.notify()]);
      await f.notify();
      expect(f.send).toHaveBeenCalledTimes(1);
      const body = JSON.parse(f.send.mock.calls[0]![1]!.body as string);
      expect(body.data).toEqual({
        kind: "STORE_EMAIL_READY",
        ownerId: f.ownerId,
        storeId: f.storeId,
        receiptId: f.receiptId,
      });
      expect(body.body).toContain("choisir leur traitement");
      expect(body).not.toHaveProperty("filename");
      expect((await f.receipts.findOne({ _id: f.receiptId }))?.status).toBe(
        "AWAITING_CONFIRMATION",
      );
    });
    it("legacy chat registration does not authorize email; email-only does not authorize chat", async () => {
      const f = await fixture();
      await f.ready();
      await updateDevicePushToken(db, f.principal, f.deviceId, {
        storeId: f.storeId,
        pushToken: f.token,
      });
      expect(await registeredChatPush(db, f.principal)).toBe(f.token);
      await f.notify();
      expect(f.send).not.toHaveBeenCalled();
      await f.enable();
      expect(await registeredChatPush(db, f.principal)).toBeUndefined();
      await f.notify();
      expect(f.send).toHaveBeenCalledTimes(1);
    });
    it.each([
      "membership",
      "binding",
      "receipt",
      "session",
      "expiry",
      "owner",
      "store",
      "conversation",
      "disabled",
    ])("does not deliver after invalid %s", async (kind) => {
      const f = await fixture();
      await f.enable();
      await f.ready();
      if (kind === "membership")
        await db
          .collection("storeMemberships")
          .updateOne({ userId: f.ownerId }, { $set: { active: false } });
      if (kind === "binding")
        await f.bindings.updateOne(
          { _id: f.bindingId },
          { $set: { revokedAt: new Date() } },
        );
      if (kind === "receipt")
        await f.receipts.updateOne(
          { _id: f.receiptId },
          { $set: { status: "QUARANTINED" } },
        );
      if (kind === "session")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { revokedAt: new Date() } },
        );
      if (kind === "expiry")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { expiresAt: new Date(0) } },
        );
      if (kind === "owner")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { userId: randomUUID() } },
        );
      if (kind === "store")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { "push.storeId": randomUUID() } },
        );
      if (kind === "conversation")
        await f.receipts.updateOne(
          { _id: f.receiptId },
          { $set: { conversationId: randomUUID() } },
        );
      if (kind === "disabled") await f.enable({ chat: true, email: false });
      await f.notify();
      expect(f.send).not.toHaveBeenCalled();
    });
    it.each(["disable", "logout", "membership", "binding", "dismiss"])(
      "rechecks authority when %s wins after the envelope claim",
      async (kind) => {
        const f = await fixture();
        await f.enable();
        await f.ready();
        const collection = db.collection.bind(db),
          receipts = f.receipts;
        const update = receipts.updateOne.bind(receipts);
        const lookup = vi
          .spyOn(db, "collection")
          .mockImplementation(((name: string, options?: CollectionOptions) =>
            name === "emailIntakeReceipts"
              ? receipts
              : collection(name, options)) as typeof db.collection);
        const claim = vi
          .spyOn(receipts, "updateOne")
          .mockImplementation(async (filter, change, options) => {
            const result = await update(filter, change, options);
            if (
              !Array.isArray(change) &&
              change.$set?.readyNotificationClaimedAt
            ) {
              if (kind === "disable")
                await f.sessions.updateOne(
                  { _id: f.sessionId },
                  { $set: { "push.channels.email": false } },
                );
              if (kind === "logout")
                await f.sessions.updateOne(
                  { _id: f.sessionId },
                  { $set: { revokedAt: new Date() } },
                );
              if (kind === "membership")
                await collection("storeMemberships").updateOne(
                  { userId: f.ownerId },
                  { $set: { active: false } },
                );
              if (kind === "binding")
                await f.bindings.updateOne(
                  { _id: f.bindingId },
                  { $set: { revokedAt: new Date() } },
                );
              if (kind === "dismiss")
                await update(
                  { _id: f.receiptId },
                  { $set: { status: "DISMISSED" } },
                );
            }
            return result;
          });
        try {
          await f.notify();
          expect(f.send).not.toHaveBeenCalled();
        } finally {
          claim.mockRestore();
          lookup.mockRestore();
        }
      },
    );
    it("alerts for a terminal file failure without claiming the failed original was preserved", async () => {
      const f = await fixture();
      await f.enable();
      await f.receipts.updateOne(
        { _id: f.receiptId },
        { $set: { "files.1.status": "FAILED" } },
      );
      await f.notify();
      const body = JSON.parse(f.send.mock.calls[0]![1]!.body as string);
      expect(body.title).toBe("Documents reçus à vérifier");
      expect(body.body).toContain("n’ont pas pu être conservés");
    });
    it("a failed delivery does not change originals or cause notification retries", async () => {
      const f = await fixture();
      await f.enable();
      await f.ready();
      f.send.mockRejectedValueOnce(Error("private provider detail"));
      await expect(f.notify()).rejects.toThrow("EMAIL_PUSH_DELIVERY_FAILED");
      await f.notify();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(
        (await f.receipts.findOne({ _id: f.receiptId }))?.files.map(
          (x: { status: string }) => x.status,
        ),
      ).toEqual(["READY", "READY"]);
    });
    it("retires only the same invalid token, preserving a concurrent registration", async () => {
      const f = await fixture();
      await f.enable();
      await f.ready();
      f.send.mockImplementationOnce(async () => {
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { "push.token": "ExpoPushToken[bbbbbbbbbbbbbbbbbbbb]" } },
        );
        return Response.json({
          data: { status: "error", details: { error: "DeviceNotRegistered" } },
        });
      });
      await f.notify();
      expect((await f.sessions.findOne({ _id: f.sessionId }))?.push.token).toBe(
        "ExpoPushToken[bbbbbbbbbbbbbbbbbbbb]",
      );
    });
  },
);
