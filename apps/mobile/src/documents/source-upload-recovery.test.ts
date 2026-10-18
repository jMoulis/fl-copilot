import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { SourceDocumentRepository } from "./source-document-repository";
import { SourceUploadRecoveryRepository } from "./source-upload-recovery";
import { SourceUploadQueue } from "./source-upload-queue";
import { applyCopilotRecord } from "../copilot/conversation-repository";
import { MercalysBatchRepository } from "./mercalys-batch-repository";
const digest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0))
    try {
      db.close();
    } catch {
      /* restart test already closed */
    }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-source-recovery-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  await runLocalMigrations(a);
  const storeId = randomUUID(),
    id = randomUUID(),
    fileId = randomUUID(),
    time = "2026-10-18T12:00:00Z",
    checksum = `sha256:${"a".repeat(64)}`;
  await new SourceDocumentRepository(a).createCommercialPdf({
    document: {
      id,
      storeId,
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      originalFilename: "op.pdf",
      localFileUri: "file:///op.pdf",
      checksum,
      localProcessingStatus: "PENDING",
      remoteUploadStatus: "LOCAL_ONLY",
      version: 1,
      createdAt: time,
      updatedAt: time,
      syncState: "LOCAL_ONLY",
      dirty: true,
    },
    file: {
      id: fileId,
      storeId,
      sourceDocumentId: id,
      localUri: "file:///op.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksum,
      retentionStatus: "RETAINED",
      uploadStatus: "LOCAL_ONLY",
      createdAt: time,
      updatedAt: time,
    },
  });
  await a.runAsync(
    "UPDATE local_jobs SET status='RETRY',attempt_count=4,next_attempt_at='2026-10-19T00:00:00Z',last_error='NETWORK_ERROR'",
  );
  const repo = new SourceUploadRecoveryRepository(
    a,
    digest,
    () => "2026-10-18T13:00:00Z",
  );
  return { path, db, a, storeId, id, fileId, checksum, repo };
}
it("requeues the same task offline, retains attempts/original/domain state and survives restart without a new command", async () => {
  const f = await fixture(),
    before = f.db.prepare("SELECT * FROM source_documents").get(),
    file = f.db.prepare("SELECT * FROM local_files").get();
  const r = await f.repo.review(f.storeId, f.id);
  expect(r).toMatchObject({ canRetry: true, code: "NETWORK_ERROR" });
  await f.repo.retry(f.storeId, f.id, r.basisHash, { canRetry: () => true });
  expect(
    f.db
      .prepare(
        "SELECT id,status,attempt_count,next_attempt_at,last_error FROM local_jobs",
      )
      .all(),
  ).toEqual([
    {
      id: f.id,
      status: "RETRY",
      attempt_count: 4,
      next_attempt_at: null,
      last_error: "NETWORK_ERROR",
    },
  ]);
  expect(f.db.prepare("SELECT * FROM source_documents").get()).toEqual(before);
  expect(f.db.prepare("SELECT * FROM local_files").get()).toEqual(file);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual({
    n: 0,
  });
  expect(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales_observations").get(),
  ).toEqual({ n: 0 });
  f.db.close();
  const reopened = new DatabaseSync(f.path);
  dbs.push(reopened);
  const repo = new SourceUploadRecoveryRepository(
    new ReceiptTestDatabase(reopened),
    digest,
  );
  expect((await repo.review(f.storeId, f.id)).nextAttemptAt).toBeNull();
  await expect(
    repo.retry(f.storeId, f.id, r.basisHash, { canRetry: () => true }),
  ).rejects.toThrow("SOURCE_RECOVERY_CHANGED");
});
it.each([
  "UPDATE local_jobs SET status='RUNNING'",
  "UPDATE local_jobs SET last_error='RATE_LIMITED'",
  "UPDATE local_jobs SET status='FAILED'",
  "UPDATE local_jobs SET last_error='SOURCE_UPLOAD_LOCAL_FILE_MISSING'",
  "UPDATE local_jobs SET last_error='SOURCE_UPLOAD_INVALID'",
  "UPDATE source_documents SET remote_upload_status='CONFIRMED'",
  "UPDATE source_documents SET remote_upload_status='INVALID'",
  "UPDATE source_documents SET sync_state='CONFLICT'",
  "UPDATE local_files SET checksum='different'",
  "UPDATE local_files SET retention_status='PURGED'",
  "UPDATE local_files SET local_uri='file:///other.pdf'",
  "UPDATE local_jobs SET payload_json=json_set(payload_json,'$.localFileId','11111111-1111-4111-8111-111111111111')",
  "INSERT INTO local_jobs SELECT 'other',type,payload_json,status,attempt_count,next_attempt_at,last_error,created_at,updated_at FROM local_jobs",
])("blocks unsafe upload recovery: %s", async (sql) => {
  const f = await fixture();
  await f.a.runAsync(sql);
  const r = await f.repo.review(f.storeId, f.id);
  expect(r.canRetry).toBe(false);
  expect(r.reason).toBeTruthy();
  await expect(
    f.repo.retry(f.storeId, f.id, r.basisHash, { canRetry: () => true }),
  ).rejects.toThrow("SOURCE_RECOVERY_BLOCKED");
});
it("fails closed for foreign/deleted/unsupported sources and stale previews", async () => {
  const f = await fixture();
  await expect(f.repo.review(randomUUID(), f.id)).rejects.toThrow(
    "SOURCE_RECOVERY_UNAVAILABLE",
  );
  const r = await f.repo.review(f.storeId, f.id);
  await f.a.runAsync("UPDATE local_jobs SET attempt_count=5");
  await expect(
    f.repo.retry(f.storeId, f.id, r.basisHash, { canRetry: () => true }),
  ).rejects.toThrow("SOURCE_RECOVERY_CHANGED");
  await f.a.runAsync("UPDATE source_documents SET deleted_at=updated_at");
  await expect(f.repo.review(f.storeId, f.id)).rejects.toThrow(
    "SOURCE_RECOVERY_UNAVAILABLE",
  );
  await f.a.runAsync(
    "UPDATE source_documents SET deleted_at=NULL,source_type='WASTE_RECEIPT'",
  );
  await expect(f.repo.review(f.storeId, f.id)).rejects.toThrow(
    "SOURCE_RECOVERY_UNAVAILABLE",
  );
});
it.each(["cancel", "revoke", "commit"])(
  "rolls back an interrupted retry: %s",
  async (mode) => {
    const f = await fixture(),
      r = await f.repo.review(f.storeId, f.id),
      abort = new AbortController();
    let allowed = true;
    f.a.afterRun = (sql) => {
      if (sql.startsWith("UPDATE local_jobs")) {
        if (mode === "cancel") abort.abort();
        if (mode === "revoke") allowed = false;
      }
    };
    f.a.fail = mode === "commit";
    await expect(
      f.repo.retry(f.storeId, f.id, r.basisHash, {
        canRetry: () => allowed,
        signal: abort.signal,
      }),
    ).rejects.toThrow();
    expect(
      f.db.prepare("SELECT next_attempt_at FROM local_jobs").get(),
    ).toEqual({ next_attempt_at: "2026-10-19T00:00:00Z" });
  },
);
it("checks current authority before retry and before commit", async () => {
  const f = await fixture(),
    r = await f.repo.review(f.storeId, f.id);
  await expect(
    f.repo.retry(f.storeId, f.id, r.basisHash, { canRetry: () => false }),
  ).rejects.toThrow("SOURCE_RECOVERY_FORBIDDEN");
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    f.repo.retry(f.storeId, f.id, r.basisHash, {
      canRetry: () => true,
      signal: aborted.signal,
    }),
  ).rejects.toThrow();
});
it("paginates files and restricts a chat recovery list to its owned live intake", async () => {
  const f = await fixture(),
    ownerId = randomUUID(),
    conversationId = randomUUID();
  await applyCopilotRecord(
    f.a,
    { storeId: f.storeId, ownerId },
    "copilot_conversation",
    {
      id: conversationId,
      storeId: f.storeId,
      ownerId,
      title: "Imports",
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-10-18T12:00:00Z",
      updatedAt: "2026-10-18T12:00:00Z",
    },
  );
  await f.a.runAsync(
    "UPDATE source_documents SET source_type='MERCALYS_WASTE'",
  );
  const scope = { storeId: f.storeId, ownerId, conversationId };
  await new MercalysBatchRepository(f.a, scope).create({
    id: randomUUID(),
    ...scope,
    createdAt: "2026-10-18T12:00:00Z",
    files: [
      {
        id: randomUUID(),
        filename: "casse.xlsx",
        localUri: "file:///op.pdf",
        sizeBytes: 100,
        checksum: f.checksum,
      },
    ],
  });
  expect(
    (await f.repo.list(f.storeId, { ownerId, conversationId })).items.map(
      (r) => r.sourceDocumentId,
    ),
  ).toEqual([f.id]);
  await expect(
    f.repo.list(f.storeId, { ownerId: randomUUID(), conversationId }),
  ).rejects.toThrow();
  const r = await f.repo.review(f.storeId, f.id, { ownerId, conversationId });
  await f.a.runAsync(
    "UPDATE mercalys_intake_batches SET owner_id=?",
    randomUUID(),
  );
  await expect(
    f.repo.retry(
      f.storeId,
      f.id,
      r.basisHash,
      { canRetry: () => true },
      { ownerId, conversationId },
    ),
  ).rejects.toThrow("SOURCE_RECOVERY_UNAVAILABLE");
  for (let i = 0; i < 25; i++) {
    const id = randomUUID();
    await f.a.runAsync(
      "INSERT INTO source_documents SELECT ?,store_id,source_type,original_filename,local_file_uri,checksum,source_generated_at,business_period_start,business_period_end,local_processing_status,remote_upload_status,remote_processing_status,parser_version,extraction_model_version,version,created_at,updated_at,deleted_at,sync_state,remote_version,dirty FROM source_documents LIMIT 1",
      id,
    );
    // No file is needed to list the diagnosed block, but task linkage is still scoped.
    await f.a.runAsync(
      "INSERT INTO local_jobs SELECT ?,type,json_set(payload_json,'$.sourceDocumentId',?),status,attempt_count,next_attempt_at,last_error,created_at,updated_at FROM local_jobs LIMIT 1",
      id,
      id,
    );
  }
  const first = await f.repo.list(f.storeId),
    second = await f.repo.list(f.storeId, undefined, first.cursor);
  expect(first.items).toHaveLength(20);
  expect(first.hasMore).toBe(true);
  expect(second.items).toHaveLength(6);
  expect(
    new Set([...first.items, ...second.items].map((r) => r.sourceDocumentId))
      .size,
  ).toBe(26);
});
it("does not let the background uploader send a file linked to another store or source", async () => {
  const f = await fixture();
  await f.a.runAsync("UPDATE local_jobs SET next_attempt_at=NULL");
  await f.a.runAsync("UPDATE local_files SET store_id=?", randomUUID());
  let calls = 0;
  const queue = new SourceUploadQueue(f.a, {
    init: async () => {
      calls++;
      throw Error("must not upload");
    },
    complete: async () => {
      throw Error("must not complete");
    },
    verify: async () => {
      throw Error("must not verify");
    },
  });
  expect(await queue.process(f.storeId)).toEqual({
    attempted: 0,
    confirmed: 0,
  });
  expect(calls).toBe(0);
});
