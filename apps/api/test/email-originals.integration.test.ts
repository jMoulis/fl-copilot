import { createEmailOriginalRetry } from "../src/intake/email-original-retry.js";
import { EMAIL_DOWNLOAD_DAILY_LIMITS } from "../src/intake/email-daily-budget.js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Inngest } from "inngest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMongoDatabase } from "../src/database/mongo.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService } from "../src/database/types.js";
import { createEmailIntakeStore } from "../src/intake/email-intake-store.js";
import { createEmailOriginalProcessor } from "../src/intake/email-originals.js";
import type { EmailAttachmentTarget } from "../src/intake/resend-attachment.js";
import { buildApp } from "../src/build-app.js";
const uri = process.env.TEST_MONGODB_URI;
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private email original preservation",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_email_orig_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    async function fixture(count = 1) {
      const db = await database.getDb();
      const scope = {
        storeId: randomUUID(),
        ownerId: randomUUID(),
        conversationId: randomUUID(),
      };
      let time = Date.parse("2026-10-20T12:00:00Z");
      const now = () => new Date(time);
      await db.collection("storeMemberships").insertOne({
        storeId: scope.storeId,
        userId: scope.ownerId,
        role: "MANAGER",
        active: true,
      });
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({
          _id: scope.conversationId,
          ...scope,
          status: "ACTIVE",
          deletedAt: null,
        });
      const store = createEmailIntakeStore(database, "unit.resend.app", now);
      const binding = await store.createBinding(scope, {
        id: randomUUID(),
        conversationId: scope.conversationId,
        allowedSender: "manager@example.test",
      });
      const event = {
        eventId: `evt-${randomUUID()}`,
        payloadHash: `sha256:${"0".repeat(64)}`,
        event: {
          type: "email.received" as const,
          created_at: now().toISOString(),
          data: {
            email_id: randomUUID(),
            from: binding.allowedSender,
            to: [binding.recipient],
            bcc: [],
            received_for: [],
            subject: "Pièces jointes",
            message_id: `<${randomUUID()}@example.test>`,
            attachments: Array.from({ length: count }, (_, index) => ({
              id: randomUUID(),
              filename: `../../source-${index}.xlsx`,
              content_type:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              content_id: null,
              content_disposition: "attachment",
            })),
          },
        },
      };
      const receiptId = await store.admit(event);
      if (!receiptId) throw Error("Expected receipt");
      const objects = new Map<string, Uint8Array>();
      const bytes = new Uint8Array([7, 4, 2]);
      const downloaded = vi.fn();
      const read = vi.fn(
        async (
          input: EmailAttachmentTarget,
          authorize: () => Promise<void>,
          _signal?: AbortSignal,
          beforeDownload?: (size: number) => Promise<void>,
        ) => {
          await authorize();
          await beforeDownload?.(bytes.length);
          downloaded();
          return {
            bytes,
            checksum: checksum(bytes),
            sizeBytes: bytes.byteLength,
            declaredMimeType: input.mediaType,
            filename: input.filename,
          };
        },
      );
      const storage = {
        read: vi.fn(async (key: string) => objects.get(key) ?? null),
        write: vi.fn(async (key: string, data: Uint8Array) => {
          if (objects.has(key)) throw Error("Immutable object exists");
          objects.set(key, new Uint8Array(data));
        }),
      };
      const processor = createEmailOriginalProcessor(
        database,
        { read },
        storage,
        now,
      );
      const jobs = () =>
        db.collection<{ _id: string }>("emailIntakeOriginalJobs");
      const pending = await processor.pending(receiptId);
      const first = pending[0]!.jobId;
      const receipt = async () => (await store.list(scope)).receipts[0]!;
      return {
        db,
        scope,
        now,
        store,
        event,
        binding,
        receiptId,
        processor,
        first,
        pending,
        read,
        downloaded,
        bytes,
        storage,
        objects,
        jobs,
        receipt,
        advance: (ms = 3600000) => {
          time += ms;
        },
        revoke: () => store.revokeBinding(scope, binding.id),
      };
    }
    it("defers an owner limit without reading bytes or spending an error attempt, then resumes next day", async () => {
      const f = await fixture(2);
      const day = f.now().toISOString().slice(0, 10);
      await f.db
        .collection<Document & { _id: string }>("emailIntakeDailyUsage")
        .insertOne({
          _id: `owner:${f.scope.ownerId}:${day}`,
          day,
          ownerId: f.scope.ownerId,
          bytes: EMAIL_DOWNLOAD_DAILY_LIMITS.owner.bytes - 3,
          downloads: EMAIL_DOWNLOAD_DAILY_LIMITS.owner.downloads - 1,
        });
      expect(await f.processor.preserve(f.pending[0]!.jobId)).toEqual({
        status: "READY",
      });
      expect(await f.processor.preserve(f.pending[1]!.jobId)).toEqual({
        status: "RETRY",
        code: "DAILY_LIMIT",
      });
      expect(f.downloaded).toHaveBeenCalledTimes(1);
      const waiting = await f.jobs().findOne({ _id: f.pending[1]!.jobId });
      expect(waiting).toMatchObject({
        attempts: 1,
        budgetDeferrals: 1,
        status: "RETRY",
      });
      expect(
        (await f.receipt()).files.find(
          (file) => file.id === f.pending[1]!.jobId,
        ),
      ).toMatchObject({
        status: "PENDING",
        errorCode: "DAILY_LIMIT",
        retryAt: expect.any(String),
      });
      expect(await f.processor.pending(f.receiptId)).toEqual([]);
      f.advance(24 * 3600_000);
      expect(await f.processor.preserve(f.pending[1]!.jobId)).toEqual({
        status: "READY",
      });
      expect(f.downloaded).toHaveBeenCalledTimes(2);
      expect(
        (await f.receipt()).files.find(
          (file) => file.id === f.pending[1]!.jobId,
        ),
      ).not.toHaveProperty("retryAt");
      expect(
        await f.jobs().findOne({ _id: f.pending[1]!.jobId }),
      ).toMatchObject({ attempts: 2, budgetDeferrals: 1, status: "DONE" });
    });
    it("bounds application-wide reservations across concurrent owners and rolls the losing owner's counters back", async () => {
      const a = await fixture(),
        b = await fixture();
      a.advance(12 * 86400_000);
      b.advance(12 * 86400_000);
      const day = a.now().toISOString().slice(0, 10),
        key = `application:${day}`;
      await a.db
        .collection<Document & { _id: string }>("emailIntakeDailyUsage")
        .insertOne({
          _id: key,
          day,
          ownerId: null,
          bytes: EMAIL_DOWNLOAD_DAILY_LIMITS.application.bytes - 3,
          downloads: EMAIL_DOWNLOAD_DAILY_LIMITS.application.downloads - 1,
        });
      const results = await Promise.all([
        a.processor.preserve(a.first),
        b.processor.preserve(b.first),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["READY", "RETRY"]);
      expect(
        a.downloaded.mock.calls.length + b.downloaded.mock.calls.length,
      ).toBe(1);
      expect(
        await a.db
          .collection("emailIntakeDailyUsage")
          .findOne({ _id: key as never }),
      ).toMatchObject({
        bytes: EMAIL_DOWNLOAD_DAILY_LIMITS.application.bytes,
        downloads: EMAIL_DOWNLOAD_DAILY_LIMITS.application.downloads,
      });
      const owners = await a.db
        .collection("emailIntakeDailyUsage")
        .find({ day, ownerId: { $ne: null } })
        .toArray();
      expect(owners).toHaveLength(1);
      expect(owners[0]).toMatchObject({ bytes: 3, downloads: 1 });
    });
    it("preserves monotonically increasing claims through eight quota deferrals without exhausting the six real-error attempts", async () => {
      const f = await fixture();
      f.advance(30 * 86400_000);
      for (let i = 0; i < 8; i++) {
        const day = f.now().toISOString().slice(0, 10);
        await f.db
          .collection<Document & { _id: string }>("emailIntakeDailyUsage")
          .insertOne({
            _id: `owner:${f.scope.ownerId}:${day}`,
            day,
            ownerId: f.scope.ownerId,
            bytes: EMAIL_DOWNLOAD_DAILY_LIMITS.owner.bytes,
            downloads: 0,
          });
        expect(await f.processor.preserve(f.first)).toEqual({
          status: "RETRY",
          code: "DAILY_LIMIT",
        });
        expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
          attempts: i + 1,
          budgetDeferrals: i + 1,
          status: "RETRY",
        });
        f.advance(86400_000);
      }
      expect(f.downloaded).not.toHaveBeenCalled();
      expect(await f.processor.preserve(f.first)).toEqual({ status: "READY" });
      expect(f.downloaded).toHaveBeenCalledTimes(1);
      expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
        attempts: 9,
        budgetDeferrals: 8,
        status: "DONE",
      });
    });
    it("restarts an exhausted recoverable preservation exactly once, retaining monotone claims and immutable source identity", async () => {
      const f = await fixture(),
        initial = f.read.getMockImplementation()!;
      f.read.mockRejectedValue(Error("EMAIL_ATTACHMENT_READ_FAILED"));
      for (let i = 0; i < 6; i++) {
        await f.processor.preserve(f.first);
        f.advance();
      }
      expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
        attempts: 6,
        status: "DONE",
      });
      const service = createEmailOriginalRetry(database, f.now),
        actor = {
          storeId: f.scope.storeId,
          ownerId: f.scope.ownerId,
          deviceId: randomUUID(),
        };
      const request = {
        actionId: randomUUID(),
        conversationId: f.scope.conversationId,
        receiptId: f.receiptId,
        fileId: f.first,
      };
      expect(await service.request(request, actor)).toEqual({
        actionId: request.actionId,
      });
      expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
        attempts: 6,
        retryAttemptBase: 6,
        status: "PENDING",
      });
      f.read.mockImplementation(initial);
      expect(await f.processor.preserve(f.first)).toEqual({ status: "READY" });
      const stored = await f.jobs().findOne({ _id: f.first });
      expect(stored).toMatchObject({
        attempts: 7,
        retryAttemptBase: 6,
        status: "DONE",
      });
      expect(await service.request(request, actor)).toEqual({
        actionId: request.actionId,
      });
      expect(await f.jobs().findOne({ _id: f.first })).toEqual(stored);
      expect(f.objects.size).toBe(1);
      expect(
        await f.db
          .collection("sourceDocuments")
          .countDocuments({ storeId: f.scope.storeId }),
      ).toBe(0);
      await f.revoke();
      await expect(service.request(request, actor)).rejects.toMatchObject({
        statusCode: 403,
      });
    });
    it("replays concurrent explicit retry requests once and never erases quota history or an active retry's schedule", async () => {
      const f = await fixture();
      await f
        .jobs()
        .updateOne(
          { _id: f.first },
          { $set: { status: "DONE", attempts: 14, budgetDeferrals: 8 } },
        );
      await f.db
        .collection<Document & { _id: string }>("emailIntakeReceipts")
        .updateOne(
          { _id: f.receiptId },
          {
            $set: {
              "files.0.status": "FAILED",
              "files.0.errorCode": "PROVIDER_UNAVAILABLE",
            },
          },
        );
      const service = createEmailOriginalRetry(database, f.now),
        actor = {
          storeId: f.scope.storeId,
          ownerId: f.scope.ownerId,
          deviceId: randomUUID(),
        };
      const request = {
        actionId: randomUUID(),
        conversationId: f.scope.conversationId,
        receiptId: f.receiptId,
        fileId: f.first,
      };
      const initialVersion = (await f.receipt()).version;
      await Promise.all(
        Array.from({ length: 5 }, () => service.request(request, actor)),
      );
      expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
        status: "PENDING",
        attempts: 14,
        budgetDeferrals: 8,
        retryAttemptBase: 6,
      });
      expect(
        await f.db
          .collection("processedCommands")
          .countDocuments({ _id: request.actionId as never }),
      ).toBe(1);
      expect((await f.receipt()).version).toBe(initialVersion + 1);
      const before = await f.jobs().findOne({ _id: f.first });
      await service.request({ ...request, actionId: randomUUID() }, actor);
      expect(await f.jobs().findOne({ _id: f.first })).toEqual(before);
      await expect(
        service.request(request, { ...actor, deviceId: randomUUID() }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it.each([
      "IDENTITY_CHANGED",
      "TOO_LARGE",
      "UNSUPPORTED",
      "SCOPE_CHANGED",
    ] as const)(
      "never reinterprets a permanent %s file failure as permission to download different bytes",
      async (errorCode) => {
        const f = await fixture();
        await f
          .jobs()
          .updateOne(
            { _id: f.first },
            { $set: { status: "DONE", attempts: 6 } },
          );
        await f.db
          .collection<Document & { _id: string }>("emailIntakeReceipts")
          .updateOne(
            { _id: f.receiptId },
            {
              $set: {
                "files.0.status": "FAILED",
                "files.0.errorCode": errorCode,
              },
            },
          );
        const service = createEmailOriginalRetry(database, f.now),
          actor = {
            storeId: f.scope.storeId,
            ownerId: f.scope.ownerId,
            deviceId: randomUUID(),
          };
        const request = {
          actionId: randomUUID(),
          conversationId: f.scope.conversationId,
          receiptId: f.receiptId,
          fileId: f.first,
        };
        await expect(service.request(request, actor)).rejects.toMatchObject({
          statusCode: 409,
        });
        await expect(
          service.request(request, { ...actor, ownerId: randomUUID() }),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(await f.jobs().findOne({ _id: f.first })).toMatchObject({
          status: "DONE",
          attempts: 6,
        });
        expect(f.read).not.toHaveBeenCalled();
      },
    );
    it("retains exact private bytes and exposes no capability/proof or official business observation", async () => {
      const f = await fixture();
      expect(await f.processor.preserve(f.first)).toEqual({ status: "READY" });
      const receipt = await f.receipt();
      expect(receipt.status).toBe("AWAITING_CONFIRMATION");
      expect(receipt.files[0]).toMatchObject({
        status: "READY",
        sourceDocumentId: null,
      });
      const job = await f.jobs().findOne({ _id: f.first });
      expect(job).toMatchObject({
        status: "DONE",
        proof: { checksum: checksum(f.bytes), sizeBytes: 3 },
      });
      expect(JSON.stringify(receipt)).not.toMatch(
        /objectKey|proof|download_url|leaseId/,
      );
      expect([...f.objects.keys()][0]).not.toContain("source-");
      for (const name of [
        "sourceDocuments",
        "wasteReceipts",
        "productDailyPerformance",
        "departmentDailyPerformance",
      ])
        expect(
          await f.db
            .collection(name)
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(0);
    });
    it("creates the durable jobs atomically once for duplicate webhook deliveries", async () => {
      const f = await fixture(3);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => f.store.admit(f.event)),
      );
      expect(new Set(results)).toEqual(new Set([f.receiptId]));
      expect(await f.jobs().countDocuments({ receiptId: f.receiptId })).toBe(3);
    });
    it("claims only once under concurrent deliveries and never downloads a completed file again", async () => {
      const f = await fixture();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => f.processor.preserve(f.first)),
      );
      expect(results.filter((r) => r.status === "READY")).toHaveLength(1);
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.storage.write).toHaveBeenCalledTimes(1);
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "NOT_DUE",
      });
      expect(await f.processor.pending(f.receiptId)).toEqual([]);
    });
    it("keeps a good file when another attachment fails and retries only the failed file", async () => {
      const f = await fixture(2),
        second = f.pending[1]!.jobId;
      await f.processor.preserve(f.first);
      f.read.mockRejectedValueOnce(
        Error("provider URL and body must not be recorded"),
      );
      expect((await f.processor.preserve(second)).status).toBe("RETRY");
      expect(
        (await f.receipt()).files.map((file) => file.status).sort(),
      ).toEqual(["PENDING", "READY"]);
      expect(f.objects.size).toBe(1);
      f.advance();
      expect(await f.processor.pending(f.receiptId)).toEqual([
        { jobId: second, generation: 1 },
      ]);
      await f.processor.preserve(second);
      expect(
        (await f.receipt()).files.every((file) => file.status === "READY"),
      ).toBe(true);
      expect(f.objects.size).toBe(2);
    });
    it("recovers an immutable write with a lost acknowledgement by checking exact bytes", async () => {
      const f = await fixture();
      f.storage.write.mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
        throw Error("lost acknowledgement");
      });
      expect((await f.processor.preserve(f.first)).status).toBe("READY");
      expect(f.objects.size).toBe(1);
      expect(f.storage.read).toHaveBeenCalledTimes(1);
    });
    it("recovers an already stored original after interruption without needing a new provider URL", async () => {
      const f = await fixture();
      f.storage.write.mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
        throw Error("lost acknowledgement");
      });
      f.storage.read.mockRejectedValueOnce(
        Error("temporary storage read failure"),
      );
      expect((await f.processor.preserve(f.first)).status).toBe("RETRY");
      f.advance();
      f.read.mockRejectedValue(Error("provider has expired"));
      expect((await f.processor.preserve(f.first)).status).toBe("READY");
      expect(f.read).toHaveBeenCalledTimes(1);
      expect((await f.receipt()).files[0]!.errorCode).toBeUndefined();
      const raw = await f.db
        .collection<Document & { _id: string }>("emailIntakeReceipts")
        .findOne({ _id: f.receiptId });
      expect(raw?.originalReservedBytes).toBe(3);
    });
    it("retains stored bytes if the binding is revoked before the final database commit", async () => {
      const f = await fixture();
      f.storage.write.mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
        await f.revoke();
      });
      expect((await f.processor.preserve(f.first)).status).toBe("CANCELLED");
      expect(f.objects.size).toBe(1);
      expect((await f.receipt()).files[0]).toMatchObject({
        status: "FAILED",
        errorCode: "SCOPE_CHANGED",
      });
    });
    it("serializes aggregate byte reservations across competing file workers", async () => {
      const f = await fixture(2);
      await f.db
        .collection<{ _id: string }>("emailIntakeReceipts")
        .updateOne(
          { _id: f.receiptId },
          { $set: { originalReservedBytes: 100 * 1024 * 1024 - 3 } },
        );
      const results = await Promise.all(
        f.pending.map((j) => f.processor.preserve(j.jobId)),
      );
      expect(results.filter((r) => r.status === "READY")).toHaveLength(1);
      expect(results.filter((r) => r.status === "FAILED")).toHaveLength(1);
      expect(f.objects.size).toBe(1);
      expect(f.storage.write).toHaveBeenCalledTimes(1);
    });
    it("does not replace an original if provider bytes change after reservation", async () => {
      const f = await fixture();
      f.storage.write.mockRejectedValueOnce(Error("storage offline"));
      expect((await f.processor.preserve(f.first)).status).toBe("RETRY");
      f.advance();
      const changed = new Uint8Array([1, 1, 1]);
      f.read.mockImplementationOnce(async (input) => ({
        bytes: changed,
        sizeBytes: 3,
        checksum: checksum(changed),
        declaredMimeType: input.mediaType,
        filename: input.filename,
      }));
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "FAILED",
        code: "IDENTITY_CHANGED",
      });
      expect(f.objects.size).toBe(0);
      expect(f.storage.write).toHaveBeenCalledTimes(1);
    });
    it("does not mark a corrupt retained object ready", async () => {
      const f = await fixture();
      f.storage.write.mockImplementationOnce(async (key) => {
        f.objects.set(key, new Uint8Array([0, 0, 0]));
        throw Error("lost acknowledgement");
      });
      expect((await f.processor.preserve(f.first)).status).toBe("RETRY");
      f.advance();
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "FAILED",
        code: "IDENTITY_CHANGED",
      });
      expect((await f.receipt()).files[0]!.status).toBe("FAILED");
    });
    it("does not download after the receiving binding is revoked", async () => {
      const f = await fixture();
      await f.revoke();
      expect((await f.processor.preserve(f.first)).status).toBe("CANCELLED");
      expect(f.read).not.toHaveBeenCalled();
      expect(f.storage.write).not.toHaveBeenCalled();
      expect((await f.receipt()).files[0]).toMatchObject({
        status: "FAILED",
        errorCode: "SCOPE_CHANGED",
      });
    });
    it("rechecks authorization after provider I/O before storage", async () => {
      const f = await fixture(),
        initial = f.read.getMockImplementation()!;
      f.read.mockImplementationOnce(async (input, authorize) => {
        const result = await initial(input, authorize);
        await f.revoke();
        return result;
      });
      expect((await f.processor.preserve(f.first)).status).toBe("CANCELLED");
      expect(f.storage.write).not.toHaveBeenCalled();
      expect(f.objects.size).toBe(0);
    });
    it("never overwrites the result of a newer lease", async () => {
      const f = await fixture();
      f.storage.write.mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
        await f.jobs().updateOne(
          { _id: f.first },
          {
            $set: {
              leaseId: "other-worker",
              leaseUntil: new Date(f.now().getTime() + 1000),
            },
          },
        );
      });
      expect((await f.processor.preserve(f.first)).status).toBe("NOT_DUE");
      expect((await f.receipt()).files[0]!.status).toBe("PENDING");
      f.advance(2000);
      expect((await f.processor.preserve(f.first)).status).toBe("READY");
      expect(f.read).toHaveBeenCalledTimes(1);
    });
    it("bounds aggregate original bytes before writing and does not erase retained files", async () => {
      const f = await fixture();
      await f.db
        .collection<{ _id: string }>("emailIntakeReceipts")
        .updateOne(
          { _id: f.receiptId },
          { $set: { originalReservedBytes: 100 * 1024 * 1024 } },
        );
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "FAILED",
        code: "TOO_LARGE",
      });
      expect(f.storage.write).not.toHaveBeenCalled();
    });
    it("reports unsupported attachments individually without creating business sources", async () => {
      const f = await fixture();
      f.read.mockRejectedValueOnce(Error("EMAIL_ATTACHMENT_UNSUPPORTED"));
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "FAILED",
        code: "UNSUPPORTED",
      });
      expect((await f.receipt()).files[0]!.status).toBe("UNSUPPORTED");
      expect(f.storage.write).not.toHaveBeenCalled();
    });
    it("quarantines contradictory metadata while I/O is in progress", async () => {
      const f = await fixture(),
        initial = f.read.getMockImplementation()!;
      f.read.mockImplementationOnce(async (input, authorize) => {
        const bytes = await initial(input, authorize);
        await f.store.admit({
          ...f.event,
          event: {
            ...f.event.event,
            data: { ...f.event.event.data, subject: "Contradiction" },
          },
        });
        return bytes;
      });
      expect((await f.processor.preserve(f.first)).status).toBe("CANCELLED");
      expect((await f.receipt()).status).toBe("QUARANTINED");
      expect(f.storage.write).not.toHaveBeenCalled();
    });
    it("terminates an exhausted crashed job instead of leaving it pending forever", async () => {
      const f = await fixture();
      await f.jobs().updateOne(
        { _id: f.first },
        {
          $set: {
            status: "RUNNING",
            attempts: 6,
            leaseId: "crashed",
            leaseUntil: new Date(f.now().getTime() - 1),
          },
        },
      );
      expect(await f.processor.preserve(f.first)).toEqual({
        status: "FAILED",
        code: "READ_FAILED",
      });
      expect(f.read).not.toHaveBeenCalled();
      expect(await f.processor.pending(f.receiptId)).toEqual([]);
    });
    it("recovers a retained proof on an exhausted crashed job without another provider download even when the daily budget is full", async () => {
      const f = await fixture();
      await f.processor.preserve(f.first);
      await f.db
        .collection<Document & { _id: string }>("emailIntakeDailyUsage")
        .updateOne(
          {
            _id: `owner:${f.scope.ownerId}:${f.now().toISOString().slice(0, 10)}`,
          },
          { $set: { bytes: EMAIL_DOWNLOAD_DAILY_LIMITS.owner.bytes } },
        );
      await f.jobs().updateOne(
        { _id: f.first },
        {
          $set: {
            status: "RUNNING",
            attempts: 6,
            leaseId: "crashed",
            leaseUntil: new Date(f.now().getTime() - 1),
            nextAttemptAt: f.now(),
          },
        },
      );
      expect((await f.processor.preserve(f.first)).status).toBe("READY");
      expect(f.read).toHaveBeenCalledTimes(1);
    });
    it("keeps durable admission after queue failure and safely dispatches a replay through the actual signed route", async () => {
      const f = await fixture(),
        key = Buffer.alloc(32, 13),
        secret = `whsec_${key.toString("base64")}`;
      // The actual buildApp worker uses the real clock, unlike the deterministic fixture.
      f.advance(Date.now() - f.now().getTime() - 1000);
      const send = vi
        .spyOn(Inngest.prototype, "send")
        .mockRejectedValueOnce(
          Error(
            "untrusted provider exception /signed-capability?secret=not-for-response",
          ),
        )
        .mockResolvedValue({ ids: ["test-event"] });
      const config = parseEnvironment({
        NODE_ENV: "test",
        RESEND_RECEIVING_DOMAIN: "unit.resend.app",
        RESEND_RECEIVING_WEBHOOK_SECRET: secret,
        RESEND_API_KEY: "re_test_unused_only",
        INNGEST_EVENT_KEY: "test-unused",
        INNGEST_SIGNING_KEY: "signkey-test-unused",
      });
      const app = buildApp(config, {
        database: { ...database, close: async () => {} },
        emailIntake: f.store,
      });
      const providerEmailId = randomUUID(),
        id = `msg-${randomUUID()}`,
        timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({
        ...f.event.event,
        data: { ...f.event.event.data, email_id: providerEmailId },
      });
      const headers = {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`,
      };
      try {
        const first = await app.inject({
          method: "POST",
          url: "/api/v1/intake/resend",
          payload: body,
          headers,
        });
        expect(first.statusCode).toBe(503);
        expect(first.json()).toEqual({ error: "INBOUND_INTAKE_UNAVAILABLE" });
        expect(first.body).not.toContain("signed-capability");
        const admitted = await f.db
          .collection<Document & { _id: string }>("emailIntakeReceipts")
          .findOne({ providerEmailId });
        expect(admitted).not.toBeNull();
        expect(
          await f.jobs().countDocuments({ receiptId: admitted!._id }),
        ).toBe(1);
        const retry = await app.inject({
          method: "POST",
          url: "/api/v1/intake/resend",
          payload: body,
          headers,
        });
        expect(retry.statusCode).toBe(200);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
        expect(
          await f.db
            .collection("emailIntakeReceipts")
            .countDocuments({ providerEmailId }),
        ).toBe(1);
      } finally {
        send.mockRestore();
        await app.close();
      }
    });
    it("prevents a revoked member or archived conversation from starting a download", async () => {
      for (const reason of ["member", "conversation"]) {
        const f = await fixture();
        if (reason === "member")
          await f.db
            .collection("storeMemberships")
            .updateOne(
              { storeId: f.scope.storeId },
              { $set: { active: false } },
            );
        else
          await f.db
            .collection<{ _id: string }>("copilotConversations")
            .updateOne(
              { _id: f.scope.conversationId },
              { $set: { status: "ARCHIVED" } },
            );
        expect((await f.processor.preserve(f.first)).status).toBe("CANCELLED");
        expect(f.read).not.toHaveBeenCalled();
      }
    });
  },
);
