import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { appendCopilotResponse } from "../src/copilot/response-store";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
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
  },
);
