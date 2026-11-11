import { randomUUID } from "node:crypto";
import type { Db, Document, CollectionOptions } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { notifyDocumentReady } from "../src/notifications/document-ready";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "owned document completion alerts",
  () => {
    let database: DatabaseService, db: Db;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_document_push_${randomUUID().replaceAll("-", "")}`,
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
    async function fixture(sourceType = "WEEKLY_COMMERCIAL_PDF") {
      const storeId = randomUUID(),
        ownerId = randomUUID(),
        id = randomUUID(),
        sessionId = randomUUID();
      const source = {
        _id: id,
        storeId,
        sourceType,
        checksum: `sha256:${"a".repeat(64)}`,
        objectKey: "private/original",
        remoteUploadStatus: "CONFIRMED",
        extractionId: randomUUID(),
        productMatchingId: randomUUID(),
        productMatchingStatus: "READY",
      };
      const sources = db.collection<Document & { _id: string }>(
          "sourceDocuments",
        ),
        jobs = db.collection<Document & { _id: string }>(
          "commercialDocumentJobs",
        ),
        sessions = db.collection<Document & { _id: string }>("deviceSessions");
      await sources.insertOne(source);
      await db.collection("sourceUploads").insertOne({
        storeId,
        sourceDocumentId: id,
        userId: ownerId,
        checksum: source.checksum,
        objectKey: source.objectKey,
        status: "CONFIRMED",
      });
      await jobs.insertOne({
        _id: id,
        storeId,
        checksum: source.checksum,
        objectKey: source.objectKey,
        status: "TEXT_READY",
        parserVersion: "pdf.v1",
        pageCount: 1,
      });
      await db
        .collection("storeMemberships")
        .insertOne({ storeId, userId: ownerId, active: true, role: "MANAGER" });
      await sessions.insertOne({
        _id: sessionId,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 60_000),
        push: {
          storeId,
          token: `ExpoPushToken[${randomUUID().replaceAll("-", "")}]`,
          channels: { chat: false, email: false, documents: true },
        },
      });
      const send = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ data: { status: "ok" } }), {
            headers: { "content-type": "application/json" },
          }),
      );
      return {
        source,
        storeId,
        ownerId,
        id,
        sessionId,
        sources,
        jobs,
        sessions,
        send,
        notify: () => notifyDocumentReady(db, storeId, id, { fetch: send }),
      };
    }
    it.each(["WEEKLY_COMMERCIAL_PDF", "WASTE_RECEIPT"])(
      "sends one private content-free %s result alert under concurrent retries",
      async (kind) => {
        const f = await fixture(kind);
        await Promise.all([f.notify(), f.notify(), f.notify()]);
        expect(f.send).toHaveBeenCalledTimes(1);
        const message = JSON.parse(String(f.send.mock.calls[0]![1]!.body));
        expect(message.data).toMatchObject({
          kind: "SOURCE_DOCUMENT_READY",
          ownerId: f.ownerId,
          storeId: f.storeId,
          sourceDocumentId: f.id,
          sourceType: kind,
        });
        expect(message.collapseId).toMatch(/^[a-f0-9]{64}$/);
        expect(message.body).not.toContain("private/original");
        const retained = await f.sources.findOne({ _id: f.id });
        expect(retained).toMatchObject(f.source);
        expect(
          await db.collection("processedSyncCommands").countDocuments(),
        ).toBe(0);
      },
    );
    it.each([
      "legacy",
      "disabled",
      "revoked",
      "expired",
      "wrong-store",
      "staff",
      "withdrawn",
      "incomplete",
      "wrong-owner",
    ])("does not deliver for %s", async (why) => {
      const f = await fixture();
      if (why === "legacy")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $unset: { "push.channels.documents": "" } },
        );
      if (why === "disabled")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { "push.channels.documents": false } },
        );
      if (why === "revoked")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { revokedAt: new Date() } },
        );
      if (why === "expired")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { expiresAt: new Date(0) } },
        );
      if (why === "wrong-store")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { "push.storeId": randomUUID() } },
        );
      if (why === "wrong-owner")
        await f.sessions.updateOne(
          { _id: f.sessionId },
          { $set: { userId: randomUUID() } },
        );
      if (why === "staff")
        await db
          .collection("storeMemberships")
          .updateOne({ userId: f.ownerId }, { $set: { role: "STAFF" } });
      if (why === "withdrawn")
        await f.sources.updateOne(
          { _id: f.id },
          { $set: { deletedAt: new Date() } },
        );
      if (why === "incomplete")
        await f.jobs.updateOne({ _id: f.id }, { $set: { status: "PENDING" } });
      await f.notify();
      expect(f.send).not.toHaveBeenCalled();
    });
    it.each(["logout", "disable", "withdraw", "reprocess", "membership"])(
      "rechecks %s after the result claim",
      async (why) => {
        const f = await fixture(),
          collection = db.collection.bind(db),
          update = f.sources.updateOne.bind(f.sources);
        const lookup = vi
          .spyOn(db, "collection")
          .mockImplementation(((name: string, options?: CollectionOptions) =>
            name === "sourceDocuments"
              ? f.sources
              : collection(name, options)) as typeof db.collection);
        const claim = vi
          .spyOn(f.sources, "updateOne")
          .mockImplementation(async (filter, change, options) => {
            const result = await update(filter, change, options);
            if (
              !Array.isArray(change) &&
              change.$set?.processingNotificationKey
            ) {
              if (why === "logout")
                await f.sessions.updateOne(
                  { _id: f.sessionId },
                  { $set: { revokedAt: new Date() } },
                );
              if (why === "disable")
                await f.sessions.updateOne(
                  { _id: f.sessionId },
                  { $set: { "push.channels.documents": false } },
                );
              if (why === "withdraw")
                await update(
                  { _id: f.id },
                  { $set: { deletedAt: new Date() } },
                );
              if (why === "reprocess")
                await f.jobs.updateOne(
                  { _id: f.id },
                  { $set: { analysisRevision: 2, status: "PENDING" } },
                );
              if (why === "membership")
                await db
                  .collection("storeMemberships")
                  .updateOne(
                    { userId: f.ownerId },
                    { $set: { active: false } },
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
    it("retains a ready result after push failure and never replays delivery on an ordinary retry", async () => {
      const f = await fixture();
      f.send.mockRejectedValue(Error("private provider detail"));
      await expect(f.notify()).rejects.toThrow("DOCUMENT_PUSH_DELIVERY_FAILED");
      await f.notify();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect((await f.jobs.findOne({ _id: f.id }))?.status).toBe("TEXT_READY");
    });
    it("notifies once again after an explicit new completed processing revision", async () => {
      const f = await fixture();
      await f.notify();
      await f.jobs.updateOne({ _id: f.id }, { $set: { analysisRevision: 1 } });
      await f.notify();
      expect(f.send).toHaveBeenCalledTimes(2);
    });
  },
);
