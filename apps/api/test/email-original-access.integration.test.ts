import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiClient } from "../../../packages/api-client/src/index";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { EmailIntakeCache } from "../../mobile/src/intake/email-intake-cache";
import {
  EmailOriginalTransfer,
  type EmailOriginalFiles,
} from "../../mobile/src/intake/email-original-transfer";
import { SourceOriginalJobs } from "../../mobile/src/documents/source-original-jobs";
import { buildApp } from "../src/build-app";
import { AuthError, type AuthService } from "../src/auth/service";
import { createEmailIntakeStore } from "../src/intake/email-intake-store";
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
    async function fixture(
      storeId = randomUUID(),
      checksum = `sha256:${"a".repeat(64)}`,
    ) {
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
    it("reads an old receipt outside the first list page without a Blob capability or provider activation", async () => {
      const f = await fixture();
      await f.receipts().insertMany(
        Array.from({ length: 30 }, () => ({
          ...f.receipt,
          _id: randomUUID(),
          providerEmailId: randomUUID(),
          createdAt: new Date("2026-10-21T00:00:00Z"),
        })),
      );
      const intake = createEmailIntakeStore(database, "unit.resend.app");
      expect(
        (await intake.list(f.scope)).receipts.some(
          (receipt) => receipt.id === f.target.receiptId,
        ),
      ).toBe(false);
      const target = { ...f.scope, receiptId: f.target.receiptId };
      expect(await f.service.receipt(target)).toMatchObject({
        id: f.target.receiptId,
        files: [{ id: f.target.fileId, status: "READY" }],
      });
      for (const status of ["QUARANTINED", "DISMISSED"]) {
        await f
          .receipts()
          .updateOne({ _id: f.target.receiptId }, { $set: { status } });
        expect(await f.service.receipt(target)).toMatchObject({ status });
        await expect(f.service.manifest(f.target)).rejects.toMatchObject({
          publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
        });
      }
      expect(f.head).not.toHaveBeenCalled();
      expect(f.sign).not.toHaveBeenCalled();
      await f.db
        .collection("storeMemberships")
        .updateOne(
          { storeId: f.scope.storeId, userId: f.scope.ownerId },
          { $set: { active: false } },
        );
      await expect(f.service.receipt(target)).rejects.toMatchObject({
        publicCode: "EMAIL_ORIGINAL_UNAVAILABLE",
      });
    });
    it("does not expose receipt metadata across current owners or conversations", async () => {
      const f = await fixture(),
        other = await fixture(f.scope.storeId);
      await expect(
        f.service.receipt({ ...other.scope, receiptId: f.target.receiptId }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_ORIGINAL_UNAVAILABLE" });
      await f.db
        .collection<Document & { _id: string }>("copilotConversations")
        .updateOne(
          { _id: f.scope.conversationId },
          { $set: { status: "ARCHIVED" } },
        );
      await expect(
        f.service.receipt({ ...f.scope, receiptId: f.target.receiptId }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_ORIGINAL_UNAVAILABLE" });
    });
    it("restores exact unclassified email bytes through authenticated API/client, durable SQLite jobs and offline restart without creating business data", async () => {
      const bytes = new Uint8Array([80, 75, 3]);
      const digest = (value: string | Uint8Array) =>
        `sha256:${createHash("sha256").update(value).digest("hex")}`;
      const f = await fixture(randomUUID(), digest(bytes));
      const dir = await mkdtemp(join(tmpdir(), "fl-email-device-proof-"));
      const path = join(dir, "phone.sqlite"),
        file = join(dir, "original.bin"),
        localUri = pathToFileURL(file).href;
      let phone = new VisualTestDatabase(new DatabaseSync(path));
      let online = true,
        actor = f.scope.ownerId;
      const auth: AuthService = {
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        refreshSession: vi.fn(),
        logout: vi.fn(),
        authorizeStore: vi.fn(async (token, storeId) => {
          if (token !== actor || storeId !== f.scope.storeId)
            throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé.");
          return {
            userId: actor,
            storeId,
            role: "MANAGER",
            storeName: "Test",
            sessionId: randomUUID(),
            deviceId: randomUUID(),
          };
        }),
      };
      const store = createEmailIntakeStore(database, "unit.resend.app");
      const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
        database,
        auth,
        emailIntake: store,
        emailOriginalAccess: f.service,
      });
      const fetchPort = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          if (!online) throw Error("OFFLINE");
          const url = new URL(
            typeof input === "string" || input instanceof URL
              ? input
              : input.url,
          );
          const response = await app.inject({
            method: "GET",
            url: url.pathname + url.search,
            headers: Object.fromEntries(new Headers(init?.headers)),
          });
          return new Response(response.body, {
            status: response.statusCode,
            headers: { "content-type": "application/json" },
          });
        },
      );
      vi.stubGlobal("fetch", fetchPort);
      const client = new ApiClient("https://local.test");
      expect(
        await client.emailIntakeReceipt(actor, f.scope.storeId, {
          conversationId: f.scope.conversationId,
          receiptId: f.target.receiptId,
        }),
      ).toMatchObject({ id: f.target.receiptId });
      const historyHttp = await app.inject({
        method: "GET",
        url: "/api/v1/intake/email/decisions",
        headers: {
          authorization: `Bearer ${actor}`,
          "x-store-id": f.scope.storeId,
        },
      });
      expect(historyHttp.statusCode).toBe(200);
      expect(historyHttp.headers["cache-control"]).toBe("private, no-store");

      expect(
        await client.emailIntakeDecisionPage(actor, f.scope.storeId),
      ).toEqual({
        storeId: f.scope.storeId,
        ownerId: actor,
        cursor: null,
        decisions: [],
        nextCursor: null,
      });
      await expect(
        client.emailIntakeDecisionPage(actor, f.scope.storeId, "bad"),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/intake/email/decisions",
          })
        ).statusCode,
      ).toBe(401);

      const session = () => ({
        storeId: f.scope.storeId,
        userId: actor,
        canWrite: true,
      });
      const files: EmailOriginalFiles = {
        hash: async (text) => digest(text),
        existing: async (manifest, owner) => {
          expect(owner).toBe(f.scope.ownerId);
          try {
            const read = await readFile(file);
            expect(read.byteLength).toBe(manifest.sizeBytes);
            expect(digest(read)).toBe(manifest.checksum);
            return { localUri };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        },
        receive: async (lease, owner, check) => {
          check();
          expect(owner).toBe(f.scope.ownerId);
          expect(digest(bytes)).toBe(lease.manifest.checksum);
          expect(bytes.byteLength).toBe(lease.manifest.sizeBytes);
          await writeFile(file, bytes, { flag: "wx" });
          check();
          return { localUri };
        },
      };
      const api = {
        manifest: (
          storeId: string,
          owner: string,
          ref: Parameters<EmailOriginalTransfer["local"]>[0],
        ) => client.emailIntakeOriginalManifest(owner, storeId, ref),
        download: (
          storeId: string,
          owner: string,
          ref: Parameters<EmailOriginalTransfer["local"]>[0],
        ) => client.emailIntakeOriginalDownload(owner, storeId, ref),
      };
      const makeTransfer = () =>
        new EmailOriginalTransfer(
          new EmailIntakeCache(phone, session),
          api,
          files,
        );
      const ref = {
        conversationId: f.scope.conversationId,
        receiptId: f.target.receiptId,
        fileId: f.target.fileId,
      };
      const before = await f.receipts().findOne({ _id: f.target.receiptId });
      try {
        await runLocalMigrations(phone);
        const conversation = {
          id: f.scope.conversationId,
          storeId: f.scope.storeId,
          ownerId: f.scope.ownerId,
          title: "Documents reçus",
          status: "ACTIVE",
          version: 1,
          createdAt: "2026-10-20T12:00:00.000Z",
          updatedAt: "2026-10-20T12:00:00.000Z",
        };
        await phone.runAsync(
          "INSERT INTO copilot_conversations(id,store_id,owner_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'SYNCED',0)",
          conversation.id,
          conversation.storeId,
          conversation.ownerId,
          JSON.stringify(conversation),
        );
        const page = await client.emailIntakeList(
          actor,
          f.scope.storeId,
          f.scope.conversationId,
        );
        await new EmailIntakeCache(phone, session).storePage(f.scope, page);
        expect(page.receipts[0]?.files[0]?.id).toBe(f.target.fileId);
        const source = { recover: vi.fn() };
        const jobs = new SourceOriginalJobs(
          phone,
          source,
          session,
          randomUUID,
          undefined,
          makeTransfer(),
        );
        await jobs.requestEmail(ref);
        await jobs.process(f.scope.storeId, actor);
        expect(
          await phone.getFirstAsync("SELECT status FROM local_jobs"),
        ).toEqual({ status: "COMPLETED" });
        expect(new Uint8Array(await readFile(file))).toEqual(bytes);
        expect(source.recover).not.toHaveBeenCalled();
        expect(f.sign).toHaveBeenCalledTimes(1);
        phone.raw.close();
        phone = new VisualTestDatabase(new DatabaseSync(path));
        online = false;
        const calls = fetchPort.mock.calls.length;
        await expect(makeTransfer().recover(ref)).resolves.toEqual({
          localUri,
        });
        expect(fetchPort).toHaveBeenCalledTimes(calls);
        expect(
          await phone.getFirstAsync("SELECT * FROM sync_outbox"),
        ).toBeNull();
        expect(
          await phone.getFirstAsync("SELECT * FROM source_documents"),
        ).toBeNull();
        expect(
          await phone.getFirstAsync("SELECT * FROM source_records"),
        ).toBeNull();
        expect(await f.receipts().findOne({ _id: f.target.receiptId })).toEqual(
          before,
        );
        actor = randomUUID();
        await expect(makeTransfer().local(ref)).rejects.toThrow(
          "CONVERSATION_UNAVAILABLE",
        );
        online = true;
        await expect(
          client.emailIntakeOriginalDownload(actor, f.scope.storeId, ref),
        ).rejects.toMatchObject({
          response: { code: "EMAIL_ORIGINAL_UNAVAILABLE" },
        });
        expect(f.sign).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
        phone.raw.close();
        await app.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
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
