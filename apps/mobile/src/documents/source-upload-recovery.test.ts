import {
  restoreSourceOriginal,
  type OriginalRestorationStorage,
} from "./restore-source-original";
import {
  mercalysLocalFixture,
  mercalysWorkbook,
} from "../../../../scripts/test-mercalys-sync-fixtures";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import { MercalysBatchPreparation } from "./mercalys-batch-preparation";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
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

async function missingFixture() {
  const f = await fixture();
  await f.a.runAsync(
    "UPDATE source_documents SET remote_upload_status='FAILED',sync_state='ERROR'",
  );
  await f.a.runAsync("UPDATE local_files SET upload_status='FAILED'");
  await f.a.runAsync(
    "UPDATE local_jobs SET status='FAILED',last_error='SOURCE_UPLOAD_LOCAL_FILE_MISSING',next_attempt_at=NULL",
  );
  return f;
}
function physicalStorage(dir: string, onCopy?: () => void) {
  const created: string[] = [],
    removed: string[] = [];
  const storage: OriginalRestorationStorage = {
    copy: async (input) => {
      const path = join(dir, `recovered-${input.operationId}.pdf`);
      copyFileSync(fileURLToPath(input.uri), path, constants.COPYFILE_EXCL);
      const bytes = readFileSync(path),
        copy = {
          localUri: pathToFileURL(path).href,
          sizeBytes: bytes.length,
          mimeType: input.mimeType,
          checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        };
      created.push(copy.localUri);
      onCopy?.();
      return copy;
    },
    removeOwnedCopy: async (uri) => {
      removed.push(uri);
      unlinkSync(fileURLToPath(uri));
    },
  };
  return { storage, created, removed };
}
async function selectedOriginal(f: Awaited<ReturnType<typeof fixture>>) {
  const bytes = Buffer.alloc(100, 42),
    path = join(dirname(f.path), "selected.pdf");
  writeFileSync(path, bytes);
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  await f.a.runAsync("UPDATE source_documents SET checksum=?", checksum);
  await f.a.runAsync("UPDATE local_files SET checksum=?", checksum);
  return { uri: pathToFileURL(path).href, bytes, checksum };
}
it("restores an identical physical original offline, preserves identity/attempt history and replays exactly once after restart", async () => {
  const f = await missingFixture(),
    selected = await selectedOriginal(f),
    r = await f.repo.review(f.storeId, f.id),
    operationId = randomUUID(),
    storage = physicalStorage(dirname(f.path));
  expect(r.canRestore).toBe(true);
  const result = await restoreSourceOriginal(
    {
      storeId: f.storeId,
      sourceDocumentId: f.id,
      basisHash: r.basisHash,
      selectedUri: selected.uri,
      operationId,
    },
    f.repo,
    storage.storage,
    { canRetry: () => true },
  );
  expect(result.replayed).toBe(false);
  expect(readFileSync(fileURLToPath(result.localUri))).toEqual(selected.bytes);
  expect(readFileSync(fileURLToPath(selected.uri))).toEqual(selected.bytes);
  expect(
    f.db
      .prepare(
        "SELECT id,checksum,local_file_uri,version,local_processing_status FROM source_documents",
      )
      .get(),
  ).toMatchObject({
    id: f.id,
    checksum: selected.checksum,
    local_file_uri: result.localUri,
    version: 1,
    local_processing_status: "PENDING",
  });
  expect(
    f.db.prepare("SELECT id,attempt_count,status FROM local_jobs").get(),
  ).toMatchObject({ id: f.id, attempt_count: 4, status: "RETRY" });
  expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM source_original_restorations").get()!
      .n,
  ).toBe(1);
  const stored = f.db
    .prepare("SELECT request_json FROM source_original_restorations")
    .get()!.request_json as string;
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const repo = new SourceUploadRecoveryRepository(
    new ReceiptTestDatabase(db),
    digest,
  );
  // A later successful send does not make replay queue a new attempt.
  db.exec(
    "UPDATE local_jobs SET status='COMPLETED';UPDATE source_documents SET remote_upload_status='CONFIRMED'",
  );
  expect(
    (
      await repo.restoreOriginal(f.storeId, f.id, JSON.parse(stored).request, {
        canRetry: () => true,
      })
    ).replayed,
  ).toBe(true);
  expect(db.prepare("SELECT status FROM local_jobs").get()!.status).toBe(
    "COMPLETED",
  );
  await expect(
    repo.restoreOriginal(f.storeId, f.id, JSON.parse(stored).request, {
      canRetry: () => false,
    }),
  ).rejects.toThrow("SOURCE_RECOVERY_FORBIDDEN");
  await expect(
    repo.restoreOriginal(
      f.storeId,
      f.id,
      {
        ...JSON.parse(stored).request,
        copy: {
          ...JSON.parse(stored).request.copy,
          localUri: "file:///other.pdf",
        },
      },
      { canRetry: () => true },
    ),
  ).rejects.toThrow("SOURCE_RESTORATION_IDENTITY_CHANGED");
});
it.each([
  "different",
  "cancel",
  "revoke",
  "commit",
  "stale",
  "cancel-write",
  "revoke-write",
])(
  "preserves the old references and selection when restoration cannot commit: %s",
  async (mode) => {
    const f = await missingFixture(),
      selected = await selectedOriginal(f),
      r = await f.repo.review(f.storeId, f.id),
      abort = new AbortController();
    let allowed = true;
    if (mode === "different")
      writeFileSync(fileURLToPath(selected.uri), Buffer.alloc(100, 43));
    const storage = physicalStorage(dirname(f.path), () => {
      if (mode === "cancel") abort.abort();
      if (mode === "revoke") allowed = false;
      if (mode === "stale") f.db.exec("UPDATE local_jobs SET attempt_count=5");
    });
    f.a.afterRun = (sql) => {
      if (sql.startsWith("UPDATE local_files")) {
        if (mode === "cancel-write") abort.abort();
        if (mode === "revoke-write") allowed = false;
      }
    };
    f.a.fail = mode === "commit";
    await expect(
      restoreSourceOriginal(
        {
          storeId: f.storeId,
          sourceDocumentId: f.id,
          basisHash: r.basisHash,
          selectedUri: selected.uri,
          operationId: randomUUID(),
        },
        f.repo,
        storage.storage,
        { canRetry: () => allowed, signal: abort.signal },
      ),
    ).rejects.toThrow();
    expect(
      f.db.prepare("SELECT local_file_uri FROM source_documents").get()!
        .local_file_uri,
    ).toBe("file:///op.pdf");
    expect(f.db.prepare("SELECT status FROM local_jobs").get()!.status).toBe(
      "FAILED",
    );
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM source_original_restorations").get()!
        .n,
    ).toBe(0);
    expect(storage.removed).toEqual(storage.created);
    expect(existsSync(fileURLToPath(selected.uri))).toBe(true);
  },
);
it("retains the verified copy when an uncertain completion follows a committed attachment", async () => {
  const f = await missingFixture(),
    selected = await selectedOriginal(f),
    r = await f.repo.review(f.storeId, f.id),
    storage = physicalStorage(dirname(f.path)),
    original = f.repo.restoreOriginal.bind(f.repo);
  f.repo.restoreOriginal = async (...args) => {
    await original(...args);
    throw Error("completion lost");
  };
  await expect(
    restoreSourceOriginal(
      {
        storeId: f.storeId,
        sourceDocumentId: f.id,
        basisHash: r.basisHash,
        selectedUri: selected.uri,
        operationId: randomUUID(),
      },
      f.repo,
      storage.storage,
      { canRetry: () => true },
    ),
  ).rejects.toThrow("completion lost");
  expect(storage.removed).toEqual([]);
  expect(existsSync(fileURLToPath(storage.created[0]!))).toBe(true);
});
it.each([
  "invalid",
  "confirmed",
  "running",
  "duplicate",
  "wrong-file",
  "conflict",
  "withdrawn",
])("refuses restoration in an unsafe source state: %s", async (mode) => {
  const f = await missingFixture();
  if (mode === "invalid")
    await f.a.runAsync(
      "UPDATE local_jobs SET last_error='SOURCE_UPLOAD_INVALID'",
    );
  if (mode === "confirmed")
    await f.a.runAsync(
      "UPDATE source_documents SET remote_upload_status='CONFIRMED'",
    );
  if (mode === "running")
    await f.a.runAsync("UPDATE local_jobs SET status='RUNNING'");
  if (mode === "duplicate")
    await f.a.runAsync(
      "INSERT INTO local_jobs SELECT 'other',type,payload_json,status,attempt_count,next_attempt_at,last_error,created_at,updated_at FROM local_jobs",
    );
  if (mode === "wrong-file")
    await f.a.runAsync(
      "UPDATE local_files SET checksum=?",
      `sha256:${"b".repeat(64)}`,
    );
  if (mode === "conflict")
    await f.a.runAsync("UPDATE source_documents SET sync_state='CONFLICT'");
  if (mode === "withdrawn")
    await f.a.runAsync("UPDATE local_files SET retention_status='PURGED'");
  const r = await f.repo.review(f.storeId, f.id);
  expect(r.canRestore).toBe(false);
  await expect(
    f.repo.restoreOriginal(
      f.storeId,
      f.id,
      {
        operationId: randomUUID(),
        basisHash: r.basisHash,
        copy: {
          localUri: "file:///new.pdf",
          checksum: f.checksum,
          sizeBytes: 100,
          mimeType: "application/pdf",
        },
      },
      { canRetry: () => true },
    ),
  ).rejects.toThrow("SOURCE_RESTORATION_BLOCKED");
});
it("restores a published Mercalys source without changing observations, frozen Outbox or the chat intake manifest, then rereads it from the restored copy", async () => {
  const f = await fixture(),
    productId = randomUUID();
  f.db.exec(
    "DELETE FROM local_jobs;DELETE FROM local_files;DELETE FROM source_documents;",
  );
  await mercalysLocalFixture(f.a, f.storeId, productId);
  const workbook = mercalysWorkbook(f.storeId, productId),
    publication = new MercalysImportPublicationRepository(f.a, randomUUID);
  const published = await publication.publish(workbook.input);
  const ownerId = randomUUID(),
    batchId = randomUUID(),
    itemId = randomUUID(),
    batch = new MercalysBatchRepository(f.a, { storeId: f.storeId, ownerId });
  const input = {
    id: batchId,
    storeId: f.storeId,
    ownerId,
    conversationId: null,
    createdAt: "2026-10-18T12:00:00Z",
    files: [
      {
        id: itemId,
        filename: workbook.input.filename,
        localUri: workbook.input.localFileUri,
        sizeBytes: workbook.bytes.length,
        checksum: workbook.input.checksum,
      },
    ],
  };
  await batch.create(input);
  const tables = [
      "sales_observations",
      "source_records",
      "sync_outbox",
      "mercalys_intake_batches",
      "mercalys_intake_items",
    ],
    before = tables.map((t) => f.db.prepare(`SELECT * FROM ${t}`).all());
  await f.a.runAsync(
    "UPDATE source_documents SET remote_upload_status='FAILED',sync_state='ERROR'",
  );
  await f.a.runAsync("UPDATE local_files SET upload_status='FAILED'");
  await f.a.runAsync(
    "UPDATE local_jobs SET status='FAILED',last_error='SOURCE_UPLOAD_LOCAL_FILE_MISSING' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
  );
  const path = join(dirname(f.path), "selected.xlsx");
  writeFileSync(path, workbook.bytes);
  const r = await f.repo.review(f.storeId, published.sourceDocumentId),
    storage = physicalStorage(dirname(f.path));
  const result = await restoreSourceOriginal(
    {
      storeId: f.storeId,
      sourceDocumentId: published.sourceDocumentId,
      basisHash: r.basisHash,
      selectedUri: pathToFileURL(path).href,
      operationId: randomUUID(),
    },
    f.repo,
    storage.storage,
    { canRetry: () => true },
  );
  expect(tables.map((t) => f.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(
    before,
  );
  expect((await batch.get(batchId, itemId)).localUri).toBe(
    input.files[0]!.localUri,
  );
  expect(await batch.retainedLocation(batchId, itemId)).toBe(result.localUri);
  const preparation = new MercalysBatchPreparation(batch, {
    read: async (uri) => new Uint8Array(readFileSync(fileURLToPath(uri))),
    checksum: async (bytes) =>
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    catalog: async () => ({ products: [], identifiers: [], aliases: [] }),
    publication,
  });
  const read = await preparation.readValidated(batchId, itemId);
  expect(read.summary.lines).toHaveLength(2);
  expect(read.item.checksum).toBe(workbook.input.checksum);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM sales_observations").get()!.n,
  ).toBe(1);
});

it("blocks restoration and cleans only the new copy if private intake ownership changes during selection", async () => {
  const f = await missingFixture(),
    selected = await selectedOriginal(f),
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
    "UPDATE source_documents SET source_type='MERCALYS_SALES'",
  );
  await f.a.runAsync(
    "UPDATE local_files SET mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
  );
  const scope = { ownerId, conversationId };
  await new MercalysBatchRepository(f.a, {
    storeId: f.storeId,
    ...scope,
  }).create({
    id: randomUUID(),
    storeId: f.storeId,
    ...scope,
    createdAt: "2026-10-18T12:00:00Z",
    files: [
      {
        id: randomUUID(),
        filename: "ventes.xlsx",
        localUri: "file:///op.pdf",
        sizeBytes: 100,
        checksum: selected.checksum,
      },
    ],
  });
  const r = await f.repo.review(f.storeId, f.id, scope),
    storage = physicalStorage(dirname(f.path), () => {
      f.db
        .prepare("UPDATE mercalys_intake_batches SET owner_id=?")
        .run(randomUUID());
    });
  expect(r.canRestore).toBe(true);
  await expect(
    restoreSourceOriginal(
      {
        storeId: f.storeId,
        sourceDocumentId: f.id,
        basisHash: r.basisHash,
        selectedUri: selected.uri,
        operationId: randomUUID(),
      },
      f.repo,
      storage.storage,
      { canRetry: () => true },
      scope,
    ),
  ).rejects.toThrow("SOURCE_RECOVERY_UNAVAILABLE");
  expect(storage.removed).toEqual(storage.created);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM source_original_restorations").get()!
      .n,
  ).toBe(0);
});
