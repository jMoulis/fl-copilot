import { createHash, randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMongoDatabase } from "../src/database/mongo.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService } from "../src/database/types.js";
import { createEmailOriginalAccess } from "../src/intake/email-original-access.js";
import { emailOriginalObjectKey } from "../src/intake/email-originals.js";
import { serializeEmailIntakeOriginalMetadata } from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private email original access",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_email_access_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);
    async function fixture(storeId = randomUUID()) {
      const db = await database.getDb(),
        scope = {
          storeId,
          ownerId: randomUUID(),
          conversationId: randomUUID(),
        },
        receiptId = randomUUID(),
        fileId = randomUUID(),
        bindingId = randomUUID();
      const target = { ...scope, receiptId, fileId },
        checksum = `sha256:${"a".repeat(64)}`,
        mime = "application/zip";
      let time = Date.parse("2026-10-20T12:00:00Z");
      const now = () => new Date(time);
      await db.collection("storeMemberships").insertOne({
        storeId,
        userId: scope.ownerId,
        active: true,
        role: "MANAGER",
      });
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({
          _id: scope.conversationId,
          ...scope,
          status: "ACTIVE",
          deletedAt: null,
        });
      const receipt = {
        _id: receiptId,
        ...scope,
        bindingId,
        providerEmailId: randomUUID(),
        metadataHash: "private",
        sender: "manager@example.test",
        subject: "Sources",
        createdAt: now(),
        receivedAt: now(),
        updatedAt: now(),
        version: 2,
        status: "AWAITING_CONFIRMATION",
        files: [
          {
            id: fileId,
            providerAttachmentId: randomUUID(),
            filename: "ventes.zip",
            mediaType: mime,
            status: "READY",
            sourceDocumentId: null,
          },
        ],
      };
      const key = emailOriginalObjectKey(
        { ...scope, receiptId, _id: fileId },
        checksum,
      );
      await db
        .collection<Document & { _id: string }>("emailIntakeReceipts")
        .insertOne(receipt);
      await db
        .collection<Document & { _id: string }>("emailIntakeOriginalJobs")
        .insertOne({
          _id: fileId,
          receiptId,
          ...scope,
          bindingId,
          status: "DONE",
          attempts: 1,
          createdAt: now(),
          updatedAt: now(),
          nextAttemptAt: now(),
          proof: {
            objectKey: key,
            checksum,
            sizeBytes: 3,
            declaredMimeType: mime,
          },
        });
      const head = vi.fn(async (pathname: string) => ({
        pathname,
        size: 3,
        contentType: mime,
        url: "https://not-a-download.test/private",
        etag: "blob-version",
      }));
      const sign = vi.fn(
        async (pathname: string, expiry: number) =>
          `https://unit.private.blob.vercel-storage.com/${pathname}?expires=${expiry}&signature=test-only`,
      );
      const authorize = vi.fn(async () => {});
      const service = createEmailOriginalAccess(database, { head }, sign, now);
      return {
        db,
        scope,
        target,
        key,
        receipt,
        head,
        sign,
        authorize,
        service,
        advance: (ms: number) => {
          time += ms;
        },
        jobs: () =>
          db.collection<Document & { _id: string }>("emailIntakeOriginalJobs"),
        receipts: () =>
          db.collection<Document & { _id: string }>("emailIntakeReceipts"),
      };
    }
    it("returns a hash-bound unclassified manifest without private storage paths or capabilities", async () => {
      const f = await fixture(),
        m = await f.service.manifest(f.target, f.authorize),
        { manifestHash, ...metadata } = m;
      expect(manifestHash).toBe(
        `sha256:${createHash("sha256").update(serializeEmailIntakeOriginalMetadata(metadata)).digest("hex")}`,
      );
      expect(m).toMatchObject({
        ...f.scope,
        receiptId: f.target.receiptId,
        fileId: f.target.fileId,
        declaredMimeType: "application/zip",
        sizeBytes: 3,
      });
      expect(m).not.toHaveProperty("sourceType");
      expect(JSON.stringify(m)).not.toMatch(/objectKey|token|signature|http/);
      expect(f.sign).not.toHaveBeenCalled();
      expect(f.authorize).toHaveBeenCalledTimes(2);
    });
    it("returns only a short private download capability for the same checked manifest", async () => {
      const f = await fixture(),
        d = await f.service.download(f.target, f.authorize);
      expect(d.expiresAt).toBe("2026-10-20T12:02:00.000Z");
      expect(d.url).toContain("unit.private.blob.vercel-storage.com");
      expect(f.sign).toHaveBeenCalledWith(f.key, Date.parse(d.expiresAt));
      expect(f.authorize).toHaveBeenCalledTimes(3);
      const job = await f.jobs().findOne({ _id: f.target.fileId });
      expect(JSON.stringify(job)).not.toContain("signature=test-only");
    });
    it("refuses another active owner's receipt even within the same store", async () => {
      const f = await fixture(),
        other = await fixture(f.scope.storeId);
      await expect(
        f.service.download({
          ...other.target,
          receiptId: f.target.receiptId,
          fileId: f.target.fileId,
        }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_ORIGINAL_UNAVAILABLE" });
      expect(f.head).not.toHaveBeenCalled();
      expect(f.sign).not.toHaveBeenCalled();
    });
    it("does not cross store, conversation, receipt or file identities", async () => {
      const f = await fixture();
      for (const field of [
        "storeId",
        "conversationId",
        "receiptId",
        "fileId",
      ] as const)
        await expect(
          f.service.manifest({ ...f.target, [field]: randomUUID() }),
        ).rejects.toMatchObject({ publicCode: "EMAIL_ORIGINAL_UNAVAILABLE" });
      expect(f.head).not.toHaveBeenCalled();
    });
    it("keeps quarantined or dismissed receipts from issuing new capabilities", async () => {
      for (const status of ["QUARANTINED", "DISMISSED"]) {
        const f = await fixture();
        await f
          .receipts()
          .updateOne({ _id: f.target.receiptId }, { $set: { status } });
        await expect(f.service.download(f.target)).rejects.toMatchObject({
          publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
        });
        expect(f.sign).not.toHaveBeenCalled();
      }
    });
    it("does not pretend a pending file or running job is ready", async () => {
      for (const missing of ["file", "job"]) {
        const f = await fixture();
        if (missing === "file")
          await f
            .receipts()
            .updateOne(
              { _id: f.target.receiptId },
              { $set: { "files.0.status": "PENDING" } },
            );
        else
          await f
            .jobs()
            .updateOne(
              { _id: f.target.fileId },
              { $set: { status: "RUNNING" } },
            );
        await expect(f.service.download(f.target)).rejects.toMatchObject({
          publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
        });
        expect(f.sign).not.toHaveBeenCalled();
      }
    });
    it("reconstructs the immutable key instead of trusting a persisted foreign path", async () => {
      const f = await fixture();
      await f
        .jobs()
        .updateOne(
          { _id: f.target.fileId },
          { $set: { "proof.objectKey": "stores/foreign/object" } },
        );
      await expect(f.service.download(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_CHANGED",
      });
      expect(f.head).not.toHaveBeenCalled();
      expect(f.sign).not.toHaveBeenCalled();
    });
    it("compares Blob pathname, actual size and declared MIME before signing", async () => {
      for (const change of [
        { pathname: "foreign" },
        { size: 4 },
        { contentType: "text/html" },
      ]) {
        const f = await fixture(),
          read = f.head.getMockImplementation()!;
        f.head.mockImplementationOnce(async (key) => ({
          ...(await read(key)),
          ...change,
        }));
        await expect(f.service.download(f.target)).rejects.toMatchObject({
          publicCode: "EMAIL_ORIGINAL_CHANGED",
        });
        expect(f.sign).not.toHaveBeenCalled();
      }
    });
    it("does not return a capability when membership is revoked during storage I/O", async () => {
      const f = await fixture(),
        read = f.head.getMockImplementation()!;
      f.head.mockImplementationOnce(async (key) => {
        const blob = await read(key);
        await f.db
          .collection("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.ownerId },
            { $set: { active: false } },
          );
        return blob;
      });
      await expect(f.service.download(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
      });
      expect(f.sign).not.toHaveBeenCalled();
    });
    it("refuses changed file metadata after a storage read", async () => {
      const f = await fixture(),
        read = f.head.getMockImplementation()!;
      f.head.mockImplementationOnce(async (key) => {
        const blob = await read(key);
        await f
          .receipts()
          .updateOne(
            { _id: f.target.receiptId },
            { $set: { "files.0.filename": "different.zip" } },
          );
        return blob;
      });
      await expect(f.service.download(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_CHANGED",
      });
      expect(f.sign).not.toHaveBeenCalled();
    });
    it("rechecks scope and manifest after signing, withholding the URL on deletion", async () => {
      const f = await fixture(),
        sign = f.sign.getMockImplementation()!;
      f.sign.mockImplementationOnce(async (key, expiry) => {
        const url = await sign(key, expiry);
        await f.db
          .collection<Document & { _id: string }>("copilotConversations")
          .updateOne(
            { _id: f.scope.conversationId },
            { $set: { deletedAt: new Date() } },
          );
        return url;
      });
      await expect(f.service.download(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
      });
    });
    it("does not return an already expired capability", async () => {
      const f = await fixture(),
        sign = f.sign.getMockImplementation()!;
      f.sign.mockImplementationOnce(async (key, expiry) => {
        const url = await sign(key, expiry);
        f.advance(120000);
        return url;
      });
      await expect(f.service.download(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
      });
    });
    it("refuses malformed proof dates rather than leaking an internal exception", async () => {
      const f = await fixture();
      await f
        .jobs()
        .updateOne(
          { _id: f.target.fileId },
          { $set: { updatedAt: "invalid-date" } },
        );
      await expect(f.service.manifest(f.target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_CHANGED",
      });
      expect(f.head).not.toHaveBeenCalled();
    });
  },
);
