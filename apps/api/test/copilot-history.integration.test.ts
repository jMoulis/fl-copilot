import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { readCopilotHistory, historyQuerySchema } from "../src/copilot/history";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import type {
  SyncPushRequest,
  CopilotConversation,
  CopilotMessage,
} from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private Copilot history transactions",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_chat_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
      }
    });
    function request(
      e: CopilotConversation | CopilotMessage,
      expected: number | null = null,
    ): SyncPushRequest {
      const msg = "conversationId" in e;
      return {
        syncProtocolVersion: 1,
        appVersion: "test",
        storeId: e.storeId,
        deviceId: randomUUID(),
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: msg
              ? "COPILOT_MESSAGE_APPEND"
              : "COPILOT_CONVERSATION_UPSERT",
            entityType: msg ? "copilot_message" : "copilot_conversation",
            entityId: e.id,
            expectedRemoteVersion: expected,
            createdAt: e.createdAt,
            payload: e,
          },
        ],
      };
    }
    it("synchronizes deletion metadata, refuses foreign targets and restoration, and keeps old clients parse-compatible", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database);
      await push.push(request(f.conversation), "create", f.ownerId);
      await push.push(
        request({ ...f.message, attachments: [] }),
        "message",
        f.ownerId,
      );
      const db = await database.getDb();
      const removed = {
        ...f.conversation,
        deletedMessageIds: [f.message.id],
        version: 2,
        updatedAt: "2026-10-12T12:00:00.000Z",
      };
      expect(
        (
          await push.push(
            request({ ...removed, deletedMessageIds: [randomUUID()] }, 1),
            "bad-target",
            f.ownerId,
          )
        ).results[0]!.error?.code,
      ).toBe("COPILOT_DELETION_TARGET_INVALID");
      expect(
        (await push.push(request(removed, 1), "remove", f.ownerId)).results[0]!
          .status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request({ ...removed, deletedMessageIds: [], version: 3 }, 2),
            "restore",
            f.ownerId,
          )
        ).results[0]!.error?.code,
      ).toBe("COPILOT_DELETION_IMMUTABLE");
      const { serializeChatForClient } =
        await import("../src/copilot/conversation-store");
      const row = await db
        .collection<
          import("../src/copilot/conversation-store").ChatRecordDocument
        >("copilotConversations")
        .findOne({ _id: f.conversation.id });
      expect(
        serializeChatForClient("copilot_conversation", row!, true),
      ).toMatchObject({ status: "ACTIVE", deletedMessageIds: [f.message.id] });
      const legacy = serializeChatForClient(
        "copilot_conversation",
        row!,
        false,
      );
      expect(legacy).toMatchObject({ status: "ARCHIVED" });
      expect(legacy).not.toHaveProperty("deletedMessageIds");
      const scope = {
        storeId: f.storeId,
        userId: f.ownerId,
        storeName: "Test",
        role: "MANAGER",
        sessionId: randomUUID(),
        deviceId: f.deviceId,
      };
      const snapshots = createMongoSyncBootstrapService(database);
      const oldSnapshot = await snapshots.bootstrap(scope, {
        rawObservationDays: 90,
        copilotHistory: "true",
      });
      expect(
        oldSnapshot.entities.copilotConversations?.find(
          (c) => c.id === f.conversation.id,
        )?.status,
      ).toBe("ARCHIVED");
      const newSnapshot = await snapshots.bootstrap(
        scope,
        { rawObservationDays: 90, copilotHistory: "true" },
        true,
      );
      expect(
        newSnapshot.entities.copilotConversations?.find(
          (c) => c.id === f.conversation.id,
        ),
      ).toMatchObject({ status: "ACTIVE", deletedMessageIds: [f.message.id] });
      expect(
        (
          await readCopilotHistory(
            db,
            f.storeId,
            f.ownerId,
            { conversationId: f.conversation.id, limit: 50 },
            true,
          )
        ).messages,
      ).toEqual([]);

      const { readConversationGenerationHistory } =
        await import("../src/copilot/generation-history");
      const next = {
        ...f.message,
        id: randomUUID(),
        createdAt: "2026-10-13T12:00:00.000Z",
      };
      expect(
        (await readConversationGenerationHistory(db, next)).messages,
      ).toEqual([]);
      const deleted = {
        ...removed,
        status: "ARCHIVED" as const,
        deletedAt: "2026-10-14T12:00:00.000Z",
        updatedAt: "2026-10-14T12:00:00.000Z",
        version: 3,
      };
      expect(
        (await push.push(request(deleted, 2), "delete-topic", f.ownerId))
          .results[0]!.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request(
              {
                ...deleted,
                deletedAt: undefined,
                status: "ACTIVE",
                version: 4,
              },
              3,
            ),
            "restore-topic",
            f.ownerId,
          )
        ).results[0]!.error?.code,
      ).toBe("COPILOT_DELETION_IMMUTABLE");
    });
    it("persists a conversation/user message exactly once, restores only its actor and hides private changes from older clients", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database),
        r = request(f.conversation);
      expect((await push.push(r, "create", f.ownerId)).results[0]!.status).toBe(
        "APPLIED",
      );
      expect((await push.push(r, "repeat", f.ownerId)).results[0]!.status).toBe(
        "ALREADY_APPLIED",
      );
      await push.push(request(f.message), "message", f.ownerId);
      const pull = createMongoSyncPullService(database);
      expect((await pull.pull(f.storeId, { limit: 500 })).changes).toEqual([]);
      const own = await pull.pull(
        f.storeId,
        { limit: 500, copilotHistory: "true" },
        f.ownerId,
      );
      expect(own.changes).toHaveLength(2);
      expect(
        (
          await pull.pull(
            f.storeId,
            { limit: 500, copilotHistory: "true" },
            randomUUID(),
          )
        ).changes,
      ).toEqual([]);
      const scope = {
        storeId: f.storeId,
        userId: f.ownerId,
        storeName: "Test",
        role: "MANAGER",
        sessionId: randomUUID(),
        deviceId: f.deviceId,
      };
      const snap = await createMongoSyncBootstrapService(database).bootstrap(
        scope,
        { rawObservationDays: 90, copilotHistory: "true" },
      );
      expect(snap.entities.copilotMessages).toHaveLength(1);
      expect(snap.entities.copilotHistoryOwnerId).toBe(f.ownerId);
      const foreign = await createMongoSyncBootstrapService(database).bootstrap(
        { ...scope, userId: randomUUID() },
        { rawObservationDays: 90, copilotHistory: "true" },
      );
      expect(foreign.entities.copilotMessages).toEqual([]);
    });
    it("rejects forged owner/assistant and replay across users before cached responses can expose private content", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database),
        r = request(f.conversation);
      await push.push(r, "create", f.ownerId);
      const attack = await push.push(r, "replay", randomUUID());
      expect(attack.results[0]!.status).toBe("REJECTED");
      expect(attack.results[0]!.remoteEntity).toBeUndefined();
      expect(
        (
          await push.push(
            request({ ...f.message, role: "ASSISTANT" }),
            "role",
            f.ownerId,
          )
        ).results[0]!.status,
      ).toBe("REJECTED");
      expect(
        (await push.push(request(f.message), "no-actor")).results[0]!.status,
      ).toBe("REJECTED");
    });
    it("keeps concurrent messages immutable and exposes a rename conflict instead of universal last-write-wins", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database);
      await push.push(request(f.conversation), "create", f.ownerId);
      await push.push(request(f.message), "message", f.ownerId);
      await push.push(
        request({ ...f.conversation, title: "Device A", version: 2 }, 1),
        "rename",
        f.ownerId,
      );
      const clash = await push.push(
        request({ ...f.conversation, title: "Device B", version: 2 }, 1),
        "clash",
        f.ownerId,
      );
      expect(clash.results[0]!.status).toBe("CONFLICT");
      expect(
        (clash.results[0]!.remoteEntity as CopilotConversation).title,
      ).toBe("Device A");
      expect(
        (
          await push.push(
            request({ ...f.message, text: "changed" }),
            "edit",
            f.ownerId,
          )
        ).results[0]!.status,
      ).toBe("REJECTED");
    });
    it("retries a missing parent without recording a phantom failure and rejects archived/foreign conversation writes", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database),
        r = request(f.message);
      expect((await push.push(r, "early", f.ownerId)).results[0]!.status).toBe(
        "RETRYABLE_ERROR",
      );
      await push.push(request(f.conversation), "parent", f.ownerId);
      expect((await push.push(r, "retry", f.ownerId)).results[0]!.status).toBe(
        "APPLIED",
      );
      await push.push(
        request({ ...f.conversation, status: "ARCHIVED", version: 2 }, 1),
        "archive",
        f.ownerId,
      );
      expect(
        (
          await push.push(
            request({ ...f.message, id: randomUUID() }),
            "archived",
            f.ownerId,
          )
        ).results[0]!.status,
      ).toBe("REJECTED");
    });
    it("paginates history with stable equal-timestamp IDs and no cross-owner access", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database);
      await push.push(request(f.conversation), "parent", f.ownerId);
      for (let i = 0; i < 3; i++)
        await push.push(
          request({ ...f.message, id: randomUUID(), text: String(i) }),
          "message",
          f.ownerId,
        );
      const db = await database.getDb(),
        first = await readCopilotHistory(
          db,
          f.storeId,
          f.ownerId,
          historyQuerySchema.parse({
            conversationId: f.conversation.id,
            limit: 2,
          }),
        );
      expect(first.hasMore).toBe(true);
      const next = await readCopilotHistory(
        db,
        f.storeId,
        f.ownerId,
        historyQuerySchema.parse({
          conversationId: f.conversation.id,
          limit: 2,
          beforeCreatedAt: first.before!.createdAt,
          beforeId: first.before!.id,
        }),
      );
      expect(
        new Set([...first.messages, ...next.messages].map((m) => m.id)).size,
      ).toBe(3);
      expect(
        (
          await readCopilotHistory(
            db,
            f.storeId,
            randomUUID(),
            historyQuerySchema.parse({ conversationId: f.conversation.id }),
          )
        ).messages,
      ).toEqual([]);
    });
    it("binds replay identity to the owner even after record removal", async () => {
      const f = chatFixture(randomUUID),
        push = createMongoSyncPushService(database),
        r = request(f.conversation);
      await push.push(r, "create", f.ownerId);
      await (
        await database.getDb()
      )
        .collection<{ _id: string }>("copilotConversations")
        .deleteOne({ _id: f.conversation.id });
      const ownerB = randomUUID();
      const forged = {
        ...r,
        commands: [
          {
            ...r.commands[0]!,
            payload: { ...f.conversation, ownerId: ownerB },
          },
        ],
      };
      const result = await push.push(forged, "replay", ownerB);
      expect(result.results[0]!.status).toBe("REJECTED");
      expect(result.results[0]!.remoteEntity).toBeUndefined();
    });
    it("bounds a large private pull and resumes at the last included sequence without skipping messages", async () => {
      const f = chatFixture(randomUUID),
        db = await database.getDb(),
        count = 160;
      const messages = Array.from({ length: count }, () => ({
        ...f.message,
        id: randomUUID(),
        text: "x".repeat(16000),
        attachments: [],
      }));
      await db
        .collection<
          import("../src/copilot/conversation-store").ChatRecordDocument
        >("copilotMessages")
        .insertMany(messages.map((m) => ({ _id: m.id, ...m })));
      const { Long } = await import("mongodb");
      await db
        .collection<
          import("../src/sync/sync-change-service").SyncChangeDocument
        >("syncChanges")
        .insertMany(
          messages.map((m, i) => ({
            _id: randomUUID(),
            storeId: f.storeId,
            sequence: Long.fromNumber(i + 1),
            entityType: "copilot_message",
            entityId: m.id,
            operation: "UPSERT",
            entityVersion: 1,
            changedAt: new Date(m.createdAt),
            payloadRevision: null,
          })),
        );
      const pull = createMongoSyncPullService(database),
        first = await pull.pull(
          f.storeId,
          { limit: 500, copilotHistory: "true" },
          f.ownerId,
        );
      expect(first.hasMore).toBe(true);
      expect(
        Buffer.byteLength(JSON.stringify(first), "utf8"),
      ).toBeLessThanOrEqual(2 * 1024 * 1024);
      const second = await pull.pull(
        f.storeId,
        { limit: 500, copilotHistory: "true", cursor: first.nextCursor },
        f.ownerId,
      );
      expect(
        new Set([...first.changes, ...second.changes].map((c) => c.entityId))
          .size,
      ).toBe(count);
    }, 30000);
  },
);
