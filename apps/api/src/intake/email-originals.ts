import {
  reserveEmailDownload,
  nextEmailBudgetDay,
  EMAIL_DOWNLOAD_DAILY_LIMIT,
} from "./email-daily-budget.js";
import { createHash, randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import { z } from "zod";
import type { ClientSession, Db, Filter } from "mongodb";
import {
  emailIntakeOriginalMetadataSchema,
  serializeEmailIntakeOriginalMetadata,
  type EmailIntakeReceipt,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";
import {
  emailIntakeAtomic,
  emailIntakeAuthorized,
  type EmailIntakeReceiptRecord,
  type EmailIntakeBindingRecord,
} from "./email-intake-store.js";
import type { createResendAttachmentReader } from "./resend-attachment.js";

type Proof = {
  objectKey: string;
  checksum: string;
  sizeBytes: number;
  declaredMimeType: string;
};
export type EmailOriginalJob = {
  _id: string;
  receiptId: string;
  storeId: string;
  ownerId: string;
  conversationId: string;
  bindingId: string;
  status: "PENDING" | "RUNNING" | "RETRY" | "DONE" | "CANCELLED";
  attempts: number;
  budgetDeferrals?: number;
  retryAttemptBase?: number;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
  leaseId?: string;
  leaseUntil?: Date;
  proof?: Proof;
};
type Job = EmailOriginalJob;
export function emailOriginalObjectKey(
  job: Pick<Job, "storeId" | "ownerId" | "receiptId" | "_id">,
  checksum: string,
) {
  return `stores/${job.storeId}/private-email/${job.ownerId}/${job.receiptId}/${job._id}/${checksum.slice(7)}`;
}
/** Identical immutable metadata for access capabilities and admission validation. */
export function emailOriginalManifest(
  receipt: EmailIntakeReceiptRecord,
  file: EmailIntakeReceipt["files"][number],
  job: EmailOriginalJob,
) {
  if (
    !job.proof ||
    job.status !== "DONE" ||
    job.receiptId !== receipt._id ||
    job._id !== file.id ||
    job.storeId !== receipt.storeId ||
    job.ownerId !== receipt.ownerId ||
    job.conversationId !== receipt.conversationId ||
    job.bindingId !== receipt.bindingId
  )
    return null;
  const parsed = emailIntakeOriginalMetadataSchema.safeParse({
    schemaVersion: 1,
    storeId: receipt.storeId,
    ownerId: receipt.ownerId,
    conversationId: receipt.conversationId,
    receiptId: receipt._id,
    fileId: file.id,
    providerEmailId: receipt.providerEmailId,
    providerAttachmentId: file.providerAttachmentId,
    filename: file.filename,
    declaredMimeType: job.proof.declaredMimeType,
    sizeBytes: job.proof.sizeBytes,
    checksum: job.proof.checksum,
    retainedAt:
      job.updatedAt instanceof Date && Number.isFinite(job.updatedAt.getTime())
        ? job.updatedAt.toISOString()
        : null,
  });
  if (
    !parsed.success ||
    parsed.data.declaredMimeType !== file.mediaType ||
    emailOriginalObjectKey(job, parsed.data.checksum) !== job.proof.objectKey
  )
    return null;
  return {
    ...parsed.data,
    manifestHash: `sha256:${createHash("sha256").update(serializeEmailIntakeOriginalMetadata(parsed.data)).digest("hex")}`,
  };
}
type FileError = NonNullable<EmailIntakeReceipt["files"][number]["errorCode"]>;
type Reader = ReturnType<typeof createResendAttachmentReader>;
export interface EmailOriginalStorage {
  read(
    key: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array | null>;
  write(
    key: string,
    bytes: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<void>;
}
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fileLimit = 50 * 1024 * 1024,
  batchLimit = 100 * 1024 * 1024;
const attemptsLimit = 6,
  leaseMs = 180000;
const scopeChanged = () => Error("EMAIL_ATTACHMENT_SCOPE_CHANGED");
const usedAttempts = (job: Job) =>
  job.attempts - (job.budgetDeferrals ?? 0) - (job.retryAttemptBase ?? 0);
const attemptsExpression = {
  $subtract: [
    { $subtract: ["$attempts", { $ifNull: ["$budgetDeferrals", 0] }] },
    { $ifNull: ["$retryAttemptBase", 0] },
  ],
};
const due = (timestamp: Date): Filter<Job> => ({
  status: { $in: ["PENDING", "RETRY", "RUNNING"] as Job["status"][] },
  nextAttemptAt: { $lte: timestamp },
  $and: [
    {
      $or: [
        { $expr: { $lt: [attemptsExpression, attemptsLimit] } },
        {
          status: "RUNNING",
          $expr: { $eq: [attemptsExpression, attemptsLimit] },
        },
      ],
    },
    {
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lte: timestamp } },
      ],
    },
  ],
});

/** Private immutable storage; callers keep proof/keys server-side, never signed capabilities. */
export function createEmailOriginalBlobStorage(): EmailOriginalStorage {
  return {
    async read(key, maximumBytes, signal) {
      const result = await get(key, {
        access: "private",
        useCache: false,
        abortSignal: signal,
      });
      if (!result || result.statusCode !== 200) return null;
      const reader = result.stream.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0,
        complete = false;
      try {
        for (;;) {
          signal.throwIfAborted();
          const item = await reader.read();
          if (item.done) {
            complete = true;
            break;
          }
          size += item.value.byteLength;
          if (size > maximumBytes) throw Error("EMAIL_ORIGINAL_PROOF_INVALID");
          chunks.push(item.value);
        }
        return new Uint8Array(Buffer.concat(chunks, size));
      } finally {
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    async write(key, bytes, mime, signal) {
      await put(key, Buffer.from(bytes), {
        access: "private",
        contentType: mime,
        addRandomSuffix: false,
        allowOverwrite: false,
        abortSignal: signal,
      });
    },
  };
}

/** Current private source authority shared by preservation and an explicit retry.
 * A retry never needs a live download lease and never changes this source identity. */
export async function emailOriginalScope(
  db: Db,
  job: Job,
  session?: ClientSession,
) {
  if (
    !(await emailIntakeAuthorized(
      db,
      {
        storeId: job.storeId,
        ownerId: job.ownerId,
        conversationId: job.conversationId,
      },
      session,
    ))
  )
    throw scopeChanged();
  const binding = await db
    .collection<EmailIntakeBindingRecord>("emailIntakeBindings")
    .findOne(
      {
        _id: job.bindingId,
        storeId: job.storeId,
        ownerId: job.ownerId,
        conversationId: job.conversationId,
        revokedAt: null,
      },
      { session, maxTimeMS: 2000 },
    );
  const receipt = await db
    .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
    .findOne(
      {
        _id: job.receiptId,
        bindingId: job.bindingId,
        storeId: job.storeId,
        ownerId: job.ownerId,
        conversationId: job.conversationId,
        status: { $nin: ["DISMISSED", "QUARANTINED"] },
      },
      { session, maxTimeMS: 2000 },
    );
  const file = receipt?.files.find((f) => f.id === job._id);
  if (!binding || !receipt || !file) throw scopeChanged();
  return { receipt, file };
}

/** Each invocation preserves one file. Canonical parsing/publication is deliberately not invoked here. */
export function createEmailOriginalProcessor(
  database: DatabaseService,
  reader: Reader,
  storage: EmailOriginalStorage = createEmailOriginalBlobStorage(),
  now: () => Date = () => new Date(),
) {
  async function context(db: Db, job: Job, session?: ClientSession) {
    const jobs = db.collection<Job>("emailIntakeOriginalJobs");
    const live = await jobs.findOne(
      {
        _id: job._id,
        receiptId: job.receiptId,
        status: "RUNNING",
        leaseId: job.leaseId,
        leaseUntil: { $gt: now() },
      },
      { session, maxTimeMS: 2000 },
    );
    if (!live) throw Error("EMAIL_ATTACHMENT_SCOPE_UNAVAILABLE");
    const { receipt, file } = await emailOriginalScope(db, job, session);
    if (file.status === "APPLIED") throw scopeChanged();
    return { live, receipt, file };
  }
  async function finish(
    db: Db,
    job: Job,
    outcome: "READY" | "UNSUPPORTED" | "FAILED",
    error?: FileError,
    retry = false,
    budgetDeferred = false,
  ) {
    await emailIntakeAtomic(db, async (session) => {
      await context(db, job, session);
      const timestamp = now();
      const pending =
        budgetDeferred || (retry && usedAttempts(job) < attemptsLimit);
      const result = await db
        .collection<Job>("emailIntakeOriginalJobs")
        .updateOne(
          {
            _id: job._id,
            status: "RUNNING",
            leaseId: job.leaseId,
          },
          {
            $set: {
              status: pending ? "RETRY" : "DONE",
              updatedAt: timestamp,
              nextAttemptAt: budgetDeferred
                ? nextEmailBudgetDay(timestamp)
                : new Date(
                    timestamp.getTime() +
                      Math.min(3600000, 60000 * 2 ** (usedAttempts(job) - 1)),
                  ),
            },
            $unset: { leaseId: "", leaseUntil: "" },
            ...(budgetDeferred ? { $inc: { budgetDeferrals: 1 } } : {}),
          },
          { session },
        );
      if (!result.matchedCount) throw scopeChanged();
      await db
        .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
        .updateOne(
          {
            _id: job.receiptId,
            "files.id": job._id,
          },
          {
            $set: {
              "files.$.status": pending ? "PENDING" : outcome,
              updatedAt: timestamp,
              ...(error ? { "files.$.errorCode": error } : {}),
              ...(budgetDeferred
                ? {
                    "files.$.retryAt":
                      nextEmailBudgetDay(timestamp).toISOString(),
                  }
                : {}),
            },
            ...(!error || !budgetDeferred
              ? {
                  $unset: {
                    ...(!error ? { "files.$.errorCode": "" } : {}),
                    ...(!budgetDeferred ? { "files.$.retryAt": "" } : {}),
                  },
                }
              : {}),
            $inc: { version: 1 },
          },
          { session },
        );
    });
  }
  async function cancel(db: Db, job: Job) {
    await emailIntakeAtomic(db, async (session) => {
      const changed = await db
        .collection<Job>("emailIntakeOriginalJobs")
        .updateOne(
          {
            _id: job._id,
            status: "RUNNING",
            leaseId: job.leaseId,
          },
          {
            $set: { status: "CANCELLED", updatedAt: now() },
            $unset: { leaseId: "", leaseUntil: "" },
          },
          { session },
        );
      if (changed.matchedCount)
        await db
          .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
          .updateOne(
            {
              _id: job.receiptId,
              storeId: job.storeId,
              ownerId: job.ownerId,
              bindingId: job.bindingId,
              status: { $nin: ["DISMISSED", "QUARANTINED"] },
              "files.id": job._id,
            },
            {
              $set: {
                "files.$.status": "FAILED",
                "files.$.errorCode": "SCOPE_CHANGED",
                updatedAt: now(),
              },
              $unset: { "files.$.retryAt": "" },
              $inc: { version: 1 },
            },
            { session },
          );
    });
  }
  return {
    async pending(receiptId?: string) {
      if (receiptId) z.uuid().parse(receiptId);
      const db = await database.getDb(),
        timestamp = now();
      const jobs = await db
        .collection<Job>("emailIntakeOriginalJobs")
        .find({
          ...(receiptId ? { receiptId } : {}),
          ...due(timestamp),
        })
        .sort({ nextAttemptAt: 1, _id: 1 })
        .limit(50)
        .maxTimeMS(2000)
        .toArray();
      return jobs.map((j) => ({ jobId: j._id, generation: j.attempts }));
    },
    async preserve(jobId: string) {
      z.uuid().parse(jobId);
      const db = await database.getDb(),
        jobs = db.collection<Job>("emailIntakeOriginalJobs"),
        timestamp = now();
      const job = await jobs.findOneAndUpdate(
        {
          _id: jobId,
          ...due(timestamp),
        },
        {
          $set: {
            status: "RUNNING",
            leaseId: randomUUID(),
            leaseUntil: new Date(timestamp.getTime() + leaseMs),
            updatedAt: timestamp,
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: "after" },
      );
      if (!job) return { status: "NOT_DUE" as const };
      const signal = AbortSignal.timeout(150000);
      let phase: "READ" | "STORAGE" = "READ";
      const authorize = async () => {
        signal.throwIfAborted();
        await context(db, job);
      };
      try {
        const { receipt, file } = await context(db, job);
        let proof = job.proof;
        if (proof) {
          phase = "STORAGE";
          await authorize();
          const existing = await storage.read(
            proof.objectKey,
            proof.sizeBytes,
            signal,
          );
          await authorize();
          if (existing) {
            if (
              existing.byteLength !== proof.sizeBytes ||
              hash(existing) !== proof.checksum
            )
              throw Error("EMAIL_ATTACHMENT_IDENTITY_CHANGED");
            await finish(db, job, "READY");
            return { status: "READY" as const };
          }
        }
        if (usedAttempts(job) > attemptsLimit) {
          await finish(db, job, "FAILED", "READ_FAILED");
          return { status: "FAILED" as const, code: "READ_FAILED" as const };
        }
        phase = "READ";
        const original = await reader.read(
          {
            emailId: receipt.providerEmailId,
            attachmentId: file.providerAttachmentId,
            filename: file.filename,
            mediaType: file.mediaType,
            maximumBytes: proof?.sizeBytes ?? fileLimit,
          },
          authorize,
          signal,
          (size) =>
            emailIntakeAtomic(db, async (session) => {
              await context(db, job, session);
              await reserveEmailDownload(db, session, job.ownerId, size, now());
              await context(db, job, session);
            }),
        );
        if (
          original.sizeBytes !== original.bytes.byteLength ||
          hash(original.bytes) !== original.checksum ||
          original.declaredMimeType !== file.mediaType ||
          original.filename !== file.filename
        )
          throw Error("EMAIL_ATTACHMENT_IDENTITY_CHANGED");
        if (
          proof &&
          (proof.checksum !== original.checksum ||
            proof.sizeBytes !== original.sizeBytes ||
            proof.declaredMimeType !== original.declaredMimeType)
        )
          throw Error("EMAIL_ATTACHMENT_IDENTITY_CHANGED");
        if (!proof) {
          proof = {
            objectKey: emailOriginalObjectKey(job, original.checksum),
            checksum: original.checksum,
            sizeBytes: original.sizeBytes,
            declaredMimeType: original.declaredMimeType,
          };
          const reserved = proof;
          await emailIntakeAtomic(db, async (session) => {
            const { live, receipt: current } = await context(db, job, session);
            if (live.proof) throw Error("EMAIL_ATTACHMENT_IDENTITY_CHANGED");
            if (
              (current.originalReservedBytes ?? 0) + reserved.sizeBytes >
              batchLimit
            )
              throw Error("EMAIL_ATTACHMENT_TOO_LARGE");
            await jobs.updateOne(
              { _id: job._id, leaseId: job.leaseId },
              { $set: { proof: reserved } },
              { session },
            );
            await db
              .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
              .updateOne(
                { _id: job.receiptId },
                { $inc: { originalReservedBytes: reserved.sizeBytes } },
                { session },
              );
          });
        }
        phase = "STORAGE";
        await authorize();
        try {
          await storage.write(
            proof.objectKey,
            original.bytes,
            proof.declaredMimeType,
            signal,
          );
        } catch {
          // Immutable put may have succeeded before an acknowledgement was lost.
          await authorize();
          const existing = await storage.read(
            proof.objectKey,
            proof.sizeBytes,
            signal,
          );
          if (
            !existing ||
            existing.byteLength !== proof.sizeBytes ||
            hash(existing) !== proof.checksum
          )
            throw Error("EMAIL_ORIGINAL_STORAGE_UNAVAILABLE");
        }
        await authorize();
        await finish(db, job, "READY");
        return { status: "READY" as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "EMAIL_ATTACHMENT_SCOPE_UNAVAILABLE")
          return { status: "NOT_DUE" as const };
        if (message === "EMAIL_ATTACHMENT_SCOPE_CHANGED") {
          await cancel(db, job);
          return { status: "CANCELLED" as const };
        }
        const budgetDeferred = message === EMAIL_DOWNLOAD_DAILY_LIMIT;
        const permanent =
          message === "EMAIL_ATTACHMENT_UNSUPPORTED"
            ? "UNSUPPORTED"
            : message === "EMAIL_ATTACHMENT_TOO_LARGE"
              ? "TOO_LARGE"
              : [
                    "EMAIL_ATTACHMENT_IDENTITY_CHANGED",
                    "EMAIL_ATTACHMENT_CAPABILITY_INVALID",
                    "EMAIL_ATTACHMENT_METADATA_INVALID",
                    "EMAIL_ATTACHMENT_SIZE_INVALID",
                  ].includes(message)
                ? "IDENTITY_CHANGED"
                : null;
        const code: FileError = budgetDeferred
          ? "DAILY_LIMIT"
          : (permanent ??
            (phase === "STORAGE"
              ? "STORAGE_UNAVAILABLE"
              : "PROVIDER_UNAVAILABLE"));
        try {
          await finish(
            db,
            job,
            code === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED",
            code,
            !permanent,
            budgetDeferred,
          );
        } catch (failure) {
          if (
            failure instanceof Error &&
            failure.message === "EMAIL_ATTACHMENT_SCOPE_CHANGED"
          ) {
            await cancel(db, job);
            return { status: "CANCELLED" as const };
          }
          if (
            failure instanceof Error &&
            failure.message === "EMAIL_ATTACHMENT_SCOPE_UNAVAILABLE"
          )
            return { status: "NOT_DUE" as const };
          throw Error("EMAIL_ORIGINAL_STATE_UNAVAILABLE");
        }
        return {
          status:
            !budgetDeferred && (permanent || usedAttempts(job) >= attemptsLimit)
              ? ("FAILED" as const)
              : ("RETRY" as const),
          code,
        };
      }
    },
  };
}
export type EmailOriginalProcessor = ReturnType<
  typeof createEmailOriginalProcessor
>;
