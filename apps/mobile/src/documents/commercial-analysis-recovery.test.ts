import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import { commercialReviewFixture } from "../../../../scripts/test-commercial-processing-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import { readPendingWork } from "../sync/pending-work";
import { SourceDocumentRepository } from "./source-document-repository";
import {
  CommercialAnalysisRecoveryRepository,
  CommercialAnalysisRecoveryQueue,
} from "./commercial-analysis-recovery";
const dbs: DatabaseSync[] = [],
  dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0))
    try {
      db.close();
    } catch {
      /* reopened */
    }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
async function fixture(oldVersion = false) {
  const dir = mkdtempSync(join(tmpdir(), "fl-analysis-resume-"));
  dirs.push(dir);
  const path = join(dir, "db.sqlite"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  await runLocalMigrations(
    a,
    oldVersion ? localMigrations.slice(0, 43) : localMigrations,
  );
  const review = commercialReviewFixture(),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    id = review.sourceDocumentId,
    time = review.observedAt;
  await new SourceDocumentRepository(a).createCommercialPdf({
    document: {
      id,
      storeId,
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      originalFilename: "op.pdf",
      localFileUri: "file:///op.pdf",
      checksum: review.checksum,
      localProcessingStatus: "PENDING",
      remoteUploadStatus: "LOCAL_ONLY",
      version: 1,
      createdAt: time,
      updatedAt: time,
      syncState: "LOCAL_ONLY",
      dirty: true,
    },
    file: {
      id: randomUUID(),
      storeId,
      sourceDocumentId: id,
      localUri: "file:///op.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksum: review.checksum,
      retentionStatus: "RETAINED",
      uploadStatus: "LOCAL_ONLY",
      createdAt: time,
      updatedAt: time,
    },
  });
  db.exec(
    "UPDATE source_documents SET remote_upload_status='CONFIRMED'; UPDATE local_jobs SET status='COMPLETED';",
  );
  const repo = new CommercialAnalysisRecoveryRepository(
    a,
    randomUUID,
    () => time,
  );
  return { db, a, path, review, storeId, ownerId, id, time, repo };
}
const authority = { canResume: () => true };
it("upgrades v43 without changing retained sources, upload tasks or publication state; caches last verified state across restart", async () => {
  const f = await fixture(true),
    original = f.db.prepare("SELECT * FROM source_documents").all(),
    jobs = f.db.prepare("SELECT * FROM local_jobs").all();
  await runLocalMigrations(f.a);
  await f.repo.save(f.storeId, f.id, f.review);
  expect(f.db.prepare("SELECT * FROM source_documents").all()).toEqual(
    original,
  );
  expect(f.db.prepare("SELECT * FROM local_jobs").all()).toEqual(jobs);
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  expect(
    await new CommercialAnalysisRecoveryRepository(
      new ReceiptTestDatabase(db),
      randomUUID,
    ).cached(f.storeId, f.id),
  ).toEqual(f.review);
});
it("records one durable request offline, survives restart and sends the same operation once after a lost network response", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  const original = f.db.prepare("SELECT * FROM source_documents").all();
  const first = await f.repo.queue(
    f.storeId,
    f.ownerId,
    f.id,
    f.review.basisHash,
    authority,
  );
  expect(
    await f.repo.queue(
      f.storeId,
      f.ownerId,
      f.id,
      f.review.basisHash,
      authority,
    ),
  ).toEqual({ ...first, queued: false });
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  let time = f.time;
  const requests: unknown[] = [];
  let fail = true;
  const transport = {
    resume: vi.fn(
      async (
        storeId: string,
        id: string,
        input: { operationId: string; basisHash: string },
      ) => {
        requests.push(input);
        if (fail)
          throw new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Indisponible",
            retryable: true,
          });
        expect(storeId).toBe(f.storeId);
        return {
          operationId: input.operationId,
          sourceDocumentId: id,
          status: "REQUESTED" as const,
        };
      },
    ),
  };
  const q = new CommercialAnalysisRecoveryQueue(a, transport, () => time);
  await q.process(f.storeId, f.ownerId);
  expect(
    db
      .prepare(
        "SELECT status,last_error FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
      )
      .get(),
  ).toEqual({ status: "RETRY", last_error: "NETWORK_UNAVAILABLE" });
  time = "2026-10-18T12:01:00.000Z";
  fail = false;
  await Promise.all([
    q.process(f.storeId, f.ownerId),
    q.process(f.storeId, f.ownerId),
  ]);
  expect(requests).toEqual([
    { operationId: first.jobId, basisHash: f.review.basisHash },
    { operationId: first.jobId, basisHash: f.review.basisHash },
  ]);
  expect(
    db
      .prepare(
        "SELECT status,attempt_count FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
      )
      .get(),
  ).toEqual({ status: "COMPLETED", attempt_count: 2 });
  const repo = new CommercialAnalysisRecoveryRepository(a, randomUUID);
  expect(
    (
      await repo.queue(
        f.storeId,
        f.ownerId,
        f.id,
        f.review.basisHash,
        authority,
      )
    ).queued,
  ).toBe(false);
  expect(db.prepare("SELECT * FROM source_documents").all()).toEqual(original);
  expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual({
    n: 0,
  });
});
it.each(["rollback", "role", "cancel", "stale", "wrong store", "wrong source"])(
  "does not leave a request or mutate business data on %s",
  async (why) => {
    const f = await fixture();
    await f.repo.save(f.storeId, f.id, f.review);
    const cancel = new AbortController();
    let allowed = true;
    if (why === "rollback") f.a.fail = true;
    if (why === "role")
      f.a.afterRun = (sql) => {
        if (sql.startsWith("INSERT INTO local_jobs")) allowed = false;
      };
    if (why === "cancel")
      f.a.afterRun = (sql) => {
        if (sql.startsWith("INSERT INTO local_jobs")) cancel.abort();
      };
    await expect(
      f.repo.queue(
        why === "wrong store" ? randomUUID() : f.storeId,
        f.ownerId,
        why === "wrong source" ? randomUUID() : f.id,
        why === "stale" ? "c".repeat(64) : f.review.basisHash,
        { canResume: () => allowed, signal: cancel.signal },
      ),
    ).rejects.toThrow();
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
  },
);
it("isolates users and stores, recovers an interrupted send and refuses a changed original", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  await f.repo.queue(f.storeId, f.ownerId, f.id, f.review.basisHash, authority);
  expect(await readPendingWork(f.a, f.storeId, randomUUID())).toEqual([]);
  expect(await readPendingWork(f.a, f.storeId)).toEqual([]);
  expect(await readPendingWork(f.a, f.storeId, f.ownerId)).toEqual([
    {
      label: "Demandes de reprise d’analyse commerciale",
      count: 1,
      state: "En attente",
      code: null,
    },
  ]);
  const transport = { resume: vi.fn() };
  const q = new CommercialAnalysisRecoveryQueue(f.a, transport, () => f.time);
  await q.process(f.storeId, randomUUID());
  await q.process(randomUUID(), f.ownerId);
  expect(transport.resume).not.toHaveBeenCalled();
  f.db.exec(
    "UPDATE local_jobs SET status='RUNNING' WHERE type='COMMERCIAL_ANALYSIS_RESUME'; UPDATE source_documents SET checksum='changed';",
  );
  await q.process(f.storeId, f.ownerId);
  expect(transport.resume).not.toHaveBeenCalled();
  expect((await f.repo.latest(f.storeId, f.ownerId, f.id))?.status).toBe(
    "FAILED",
  );
});
it("retains the same request if the successful transport receipt cannot be committed locally", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  const first = await f.repo.queue(
    f.storeId,
    f.ownerId,
    f.id,
    f.review.basisHash,
    authority,
  );
  let once = true;
  f.a.afterRun = (sql) => {
    if (once && sql.includes("status='COMPLETED'")) {
      once = false;
      throw Error("database locked");
    }
  };
  const transport = {
    resume: vi.fn(
      async (_store: string, id: string, input: { operationId: string }) => ({
        sourceDocumentId: id,
        operationId: input.operationId,
        status: "REQUESTED" as const,
      }),
    ),
  };
  let time = f.time;
  const q = new CommercialAnalysisRecoveryQueue(f.a, transport, () => time);
  await q.process(f.storeId, f.ownerId);
  expect((await f.repo.latest(f.storeId, f.ownerId, f.id))?.status).toBe(
    "RETRY",
  );
  time = "2026-10-18T12:01:00.000Z";
  await q.process(f.storeId, f.ownerId);
  expect(transport.resume.mock.calls.map((c) => c[2].operationId)).toEqual([
    first.jobId,
    first.jobId,
  ]);
});
it("rejects contradictory pending tasks and keeps a prior cached result on an older response", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  await f.repo.queue(f.storeId, f.ownerId, f.id, f.review.basisHash, authority);
  f.db
    .prepare(
      "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) SELECT ?,type,payload_json,status,attempt_count,created_at,updated_at FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
    )
    .run(randomUUID());
  await expect(
    f.repo.queue(f.storeId, f.ownerId, f.id, f.review.basisHash, authority),
  ).rejects.toThrow("COMMERCIAL_ANALYSIS_MULTIPLE_PENDING");
  await f.repo.save(f.storeId, f.id, {
    ...f.review,
    observedAt: "2026-10-17T12:00:00.000Z",
    messageFr: "Old",
  });
  expect(await f.repo.cached(f.storeId, f.id)).toEqual(f.review);
});
it("ends permanent refusal without retrying and allows only a new current-state decision", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  await f.repo.queue(f.storeId, f.ownerId, f.id, f.review.basisHash, authority);
  const transport = {
    resume: vi.fn(async () => {
      throw new ApiClientError(409, {
        code: "COMMERCIAL_ANALYSIS_STATE_CHANGED",
        messageFr: "Actualisez",
        retryable: false,
      });
    }),
  };
  const q = new CommercialAnalysisRecoveryQueue(f.a, transport, () => f.time);
  await q.process(f.storeId, f.ownerId);
  await q.process(f.storeId, f.ownerId);
  expect(transport.resume).toHaveBeenCalledTimes(1);
  await f.repo.save(f.storeId, f.id, {
    ...f.review,
    basisHash: "c".repeat(64),
    observedAt: "2026-10-18T12:02:00.000Z",
  });
  expect(
    (await f.repo.queue(f.storeId, f.ownerId, f.id, "c".repeat(64), authority))
      .queued,
  ).toBe(true);
  expect(
    f.db
      .prepare(
        "SELECT status FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME' ORDER BY rowid",
      )
      .all(),
  ).toEqual([{ status: "SUPERSEDED" }, { status: "PENDING" }]);
});

it("repairs a malformed presentation cache using a fresh verified read without authorizing stale data", async () => {
  const f = await fixture();
  await f.repo.save(f.storeId, f.id, f.review);
  f.db.exec("UPDATE commercial_processing_cache SET payload_json='malformed'");
  expect(await f.repo.cached(f.storeId, f.id)).toBeNull();
  await expect(
    f.repo.queue(f.storeId, f.ownerId, f.id, f.review.basisHash, authority),
  ).rejects.toThrow("COMMERCIAL_ANALYSIS_REVIEW_CHANGED");
  await f.repo.save(f.storeId, f.id, f.review);
  expect(await f.repo.cached(f.storeId, f.id)).toEqual(f.review);
});
