import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  CopilotReceiptPhotoIntake,
  type ReceiptPhotoIntakeStorage,
} from "./receipt-photo-intake";
import type { CopilotReceiptPhotoBatch } from "@fl-copilot/domain";
const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0))
    try {
      db.close();
    } catch {
      /* restart */
    }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-receipts-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  await runLocalMigrations(a);
  const scope = {
      storeId: randomUUID(),
      ownerId: randomUUID(),
      deviceId: randomUUID(),
    },
    time = "2026-10-18T18:00:00.000Z";
  const repo = new CopilotConversationRepository(a, scope),
    controller = new CopilotLocalChatController(
      repo,
      scope,
      randomUUID,
      () => time,
    ),
    conversation = await controller.create();
  await controller.editText(conversation.id, "Regarde ces tickets");
  const originals = [1, 2, 3].map((i) => {
    const file = join(dir, `original-${i}.jpg`);
    writeFileSync(file, Buffer.from([255, 216, 255, i, 255, 217]));
    return {
      uri: pathToFileURL(file).href,
      filename: `Ticket ${i}.jpg`,
      mimeType: "image/jpeg" as const,
    };
  });
  const retained: string[] = [];
  const storage: ReceiptPhotoIntakeStorage = {
    size: vi.fn(async (uri) => readFileSync(fileURLToPath(uri)).length),
    retain: vi.fn(async (asset, fileId) => {
      const destination = join(dir, `copy-${fileId}.jpg`);
      copyFileSync(fileURLToPath(asset.uri), destination);
      retained.push(destination);
      const bytes = readFileSync(destination);
      return {
        localUri: pathToFileURL(destination).href,
        mimeType: "image/jpeg",
        sizeBytes: bytes.length,
        checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      };
    }),
  };
  const intake = new CopilotReceiptPhotoIntake(
      a,
      scope,
      randomUUID,
      storage,
      () => time,
    ),
    authority = {
      canCapture: () => true,
      signal: new AbortController().signal,
    };
  const batch: CopilotReceiptPhotoBatch = {
    mode: "ONE_PHOTO_PER_RECEIPT",
    assets: originals,
  };
  return {
    dir,
    path,
    db,
    a,
    scope,
    time,
    repo,
    controller,
    conversation,
    originals,
    retained,
    storage,
    intake,
    authority,
    batch,
  };
}
it("keeps physical originals and commits each canonical ticket with its private draft reference; restart and reattachment do not duplicate jobs", async () => {
  const f = await fixture(),
    before = f.db.prepare("SELECT * FROM sync_outbox").all();
  const result = await f.intake.capture(
    f.conversation.id,
    f.batch,
    f.authority,
    10,
  );
  expect(result).toMatchObject({
    imported: 3,
    failures: [],
    draft: { text: "Regarde ces tickets" },
  });
  expect(result.draft?.attachments).toHaveLength(3);
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 3,
  });
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
      )
      .get(),
  ).toEqual({ n: 3 });
  expect(f.db.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM waste_observations").get(),
  ).toEqual({ n: 0 });
  for (const [i, asset] of f.originals.entries())
    expect(readFileSync(fileURLToPath(asset.uri))).toEqual(
      Buffer.from([255, 216, 255, i + 1, 255, 217]),
    );
  const refs = result.draft!.attachments,
    repo = new WasteReceiptRepository(f.a);
  for (const ref of refs)
    expect(
      await repo.sourceSummary(f.scope.storeId, ref.sourceDocumentId),
    ).toMatchObject({
      lineCount: 0,
      receipt: {
        processingStatus: "UPLOAD_PENDING",
        confirmedWasteDate: null,
        aiStatus: "PENDING",
      },
      uploadJob: { status: "PENDING" },
    });
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db),
    conversations = new CopilotConversationRepository(a, f.scope),
    controller = new CopilotLocalChatController(
      conversations,
      f.scope,
      randomUUID,
      () => f.time,
    );
  expect((await controller.open(f.conversation.id)).draft).toEqual(
    result.draft,
  );
  await conversations.attachReceiptPhotos(
    f.conversation.id,
    refs.map((r) => r.sourceDocumentId),
    f.time,
  );
  expect(db.prepare("SELECT COUNT(*) n FROM local_jobs").get()).toEqual({
    n: 3,
  });
  const message = await controller.send(f.conversation.id);
  expect(message.attachments).toEqual(refs);
  await controller.removeMessage(f.conversation.id, message.id);
  expect(db.prepare("SELECT COUNT(*) n FROM source_documents").get()).toEqual({
    n: 3,
  });
  expect(f.retained.every(existsSync)).toBe(true);
});
it("uses exact-checksum duplicate detection without uploading or publishing the same photo twice", async () => {
  const f = await fixture();
  const first = await f.intake.capture(
    f.conversation.id,
    { ...f.batch, assets: [f.originals[0]!] },
    f.authority,
    10,
  );
  await f.intake.capture(
    f.conversation.id,
    { ...f.batch, assets: [f.originals[0]!] },
    f.authority,
    9,
  );
  const receipts = f.db
    .prepare(
      "SELECT duplicate_status,duplicate_candidate_source_document_id FROM waste_receipts ORDER BY rowid",
    )
    .all();
  expect(receipts).toEqual([
    {
      duplicate_status: "NOT_DUPLICATE",
      duplicate_candidate_source_document_id: null,
    },
    {
      duplicate_status: "POSSIBLE_DUPLICATE",
      duplicate_candidate_source_document_id:
        first.draft!.attachments[0]!.sourceDocumentId,
    },
  ]);
  expect(f.db.prepare("SELECT COUNT(*) n FROM local_jobs").get()).toEqual({
    n: 1,
  });
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM waste_observations").get(),
  ).toEqual({ n: 0 });
});
it.each([
  "cancel before",
  "cancel after copy",
  "role before",
  "role at insert",
  "cancel at binding",
  "commit failure",
])(
  "preserves sources/corrections and rolls back ticket + attachment on %s",
  async (why) => {
    const f = await fixture(),
      abort = new AbortController();
    let allowed = true;
    if (why === "cancel before") abort.abort();
    if (why === "role before") allowed = false;
    if (why === "cancel after copy") {
      const retain = f.storage.retain;
      f.storage.retain = async (...args) => {
        const r = await retain(...args);
        abort.abort();
        return r;
      };
    }
    if (why === "role at insert")
      f.a.afterRun = (sql) => {
        if (sql.includes("INSERT INTO waste_receipts")) allowed = false;
      };
    if (why === "cancel at binding")
      f.a.afterRun = (sql) => {
        if (sql.includes("INTO copilot_drafts")) abort.abort();
      };
    if (why === "commit failure") f.a.fail = true;
    const promise = f.intake.capture(
      f.conversation.id,
      { ...f.batch, assets: [f.originals[0]!] },
      { canCapture: () => allowed, signal: abort.signal },
      10,
    );
    if (why === "commit failure")
      expect(await promise).toMatchObject({
        imported: 0,
        failures: [{ code: "COPILOT_RECEIPT_PHOTO_NOT_SAVED" }],
      });
    else await expect(promise).rejects.toThrow();
    expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual(
      { n: 0 },
    );
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM source_documents").get(),
    ).toEqual({ n: 0 });
    expect((await f.repo.draft(f.conversation.id))?.attachments).toEqual([]);
    expect(f.originals.every((a) => existsSync(fileURLToPath(a.uri)))).toBe(
      true,
    );
    expect(f.retained.every(existsSync)).toBe(true);
  },
);
it.each(["foreign owner", "foreign store", "archived", "deleted"])(
  "cannot bind an intake to a %s conversation",
  async (why) => {
    const f = await fixture();
    const row = await f.repo.get(f.conversation.id);
    const entity = { ...row! };
    if (why === "archived") entity.status = "ARCHIVED";
    if (why === "deleted") {
      entity.status = "ARCHIVED";
      entity.deletedAt = f.time;
    }
    if (why.startsWith("foreign")) {
      const field = why === "foreign owner" ? "ownerId" : "storeId";
      entity[field] = randomUUID();
      f.db
        .prepare(
          `UPDATE copilot_conversations SET ${field === "ownerId" ? "owner_id" : "store_id"}=?,payload_json=? WHERE id=?`,
        )
        .run(entity[field], JSON.stringify(entity), entity.id);
    } else
      f.db
        .prepare("UPDATE copilot_conversations SET payload_json=? WHERE id=?")
        .run(JSON.stringify(entity), entity.id);
    await expect(
      f.intake.capture(f.conversation.id, f.batch, f.authority, 10),
    ).rejects.toThrow();
    expect(f.storage.retain).not.toHaveBeenCalled();
  },
);
it("keeps a successful prefix after a later copy failure and after interruption, with the original topic and text", async () => {
  const f = await fixture(),
    retain = f.storage.retain;
  let calls = 0;
  f.storage.retain = async (...args) => {
    if (++calls === 2) throw Error("private picker detail");
    return retain(...args);
  };
  const result = await f.intake.capture(
    f.conversation.id,
    f.batch,
    f.authority,
    10,
  );
  expect(result.imported).toBe(2);
  expect(result.failures).toEqual([
    { filename: "Ticket 2.jpg", code: "COPILOT_RECEIPT_PHOTO_NOT_SAVED" },
  ]);
  expect(result.draft?.text).toBe("Regarde ces tickets");
  const abort = new AbortController();
  f.storage.retain = async (...args) => {
    const r = await retain(...args);
    abort.abort();
    return r;
  };
  await expect(
    f.intake.capture(
      f.conversation.id,
      { ...f.batch, assets: [f.originals[1]!] },
      { canCapture: () => true, signal: abort.signal },
      8,
    ),
  ).rejects.toThrow("COPILOT_ATTACHMENT_CANCELLED");
  expect((await f.repo.draft(f.conversation.id))?.attachments).toHaveLength(2);
});
it.each([
  "capacity",
  "too many",
  "single too large",
  "total too large",
  "grouped pages",
])("rejects unsafe batch %s before retaining anything", async (why) => {
  const f = await fixture();
  let batch = f.batch,
    capacity = 10;
  if (why === "capacity") capacity = 2;
  if (why === "too many")
    batch = {
      ...batch,
      assets: Array.from({ length: 11 }, () => f.originals[0]!),
    };
  if (why === "single too large") f.storage.size = async () => 21 * 1024 * 1024;
  if (why === "total too large") {
    f.storage.size = async () => 20 * 1024 * 1024;
    batch = {
      ...batch,
      assets: Array.from({ length: 5 }, () => f.originals[0]!),
    };
  }
  if (why === "grouped pages")
    batch = {
      ...batch,
      mode: "ONE_RECEIPT",
    } as unknown as CopilotReceiptPhotoBatch;
  await expect(
    f.intake.capture(f.conversation.id, batch, f.authority, capacity),
  ).rejects.toThrow();
  expect(f.storage.retain).not.toHaveBeenCalled();
});
it("rejects changed copy metadata and wrong linked originals before adding an attachment", async () => {
  const f = await fixture(),
    retain = f.storage.retain;
  f.storage.retain = async (...args) => ({
    ...(await retain(...args)),
    sizeBytes: 8,
  });
  expect(
    (
      await f.intake.capture(
        f.conversation.id,
        { ...f.batch, assets: [f.originals[0]!] },
        f.authority,
        10,
      )
    ).imported,
  ).toBe(0);
  f.storage.retain = retain;
  const result = await f.intake.capture(
      f.conversation.id,
      { ...f.batch, assets: [f.originals[0]!] },
      f.authority,
      10,
    ),
    id = result.draft!.attachments[0]!.sourceDocumentId;
  await f.controller.removeAttachment(f.conversation.id, id);
  f.db
    .prepare("UPDATE local_files SET checksum=? WHERE source_document_id=?")
    .run(`sha256:${"d".repeat(64)}`, id);
  await expect(
    f.repo.attachReceiptPhotos(f.conversation.id, [id], f.time),
  ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
  expect((await f.repo.draft(f.conversation.id))?.attachments).toEqual([]);
  expect(
    await new WasteReceiptRepository(f.a).sourceSummary(randomUUID(), id),
  ).toBeNull();
});
it("sends the retained source identities through the normal uploader after offline restart, receives draft lines without publishing and keeps human dates", async () => {
  const { SourceUploadQueue } =
    await import("../documents/source-upload-queue");
  const { ApiClientError } = await import("@fl-copilot/api-client");
  const { wasteReceiptDraftSchema } =
    await import("@fl-copilot/sync-contracts");
  const f = await fixture();
  const captured = await f.intake.capture(
      f.conversation.id,
      { ...f.batch, assets: f.originals.slice(0, 2) },
      f.authority,
      10,
    ),
    refs = captured.draft!.attachments;
  let offline = true;
  const inits: string[] = [],
    completed: string[] = [];
  const transport = {
    init: vi.fn(async (_store: string, input: { sourceDocumentId: string }) => {
      inits.push(input.sourceDocumentId);
      if (offline)
        throw new ApiClientError(0, {
          code: "NETWORK_UNAVAILABLE",
          messageFr: "Hors connexion",
          retryable: true,
        });
      return {
        uploadId: input.sourceDocumentId,
        objectKey: "private/photo",
        status: "UPLOAD_REQUIRED" as const,
        uploadUrl: "https://private.invalid/upload",
        headers: {},
        expiresAt: null,
      };
    }),
    complete: vi.fn(async (_store: string, sourceDocumentId: string) => {
      completed.push(sourceDocumentId);
      return {
        sourceDocumentId,
        remoteUploadStatus: "CONFIRMED" as const,
        jobId: null,
        wasteReceiptDraft: wasteReceiptDraftSchema.parse({
          detectedReceiptDate: "2026-10-17",
          detectedCashierNumber: "000009",
          extractionModelVersion: "test",
          arithmeticValidatorVersion: "test",
          productMatcherVersion: "test",
          lines: [
            {
              lineId: randomUUID(),
              sourceLineIndex: 0,
              rawLabel: "FIGUE VRAC",
              quantity: null,
              weight: "1.5",
              quantityUnit: "KG",
              unitPrice: "2",
              totalPrice: "3",
              extractionConfidence: {},
              sourceRegion: null,
              arithmeticStatus: "CONSISTENT",
              arithmeticExpectedTotal: "3",
              arithmeticDifference: "0",
              arithmeticWarningCode: null,
              matchState: "NO_MATCH",
              matchedProductId: null,
              matchedProductLabel: null,
              matchConfidence: 0,
              productNature: "UNKNOWN",
              candidates: [],
              validationStatus: "TO_REVIEW",
            },
          ],
        }),
      };
    }),
    verify: vi.fn(),
  };
  const upload = vi.fn(async (input: { localUri: string }) => {
    expect(existsSync(fileURLToPath(input.localUri))).toBe(true);
  });
  await new SourceUploadQueue(
    f.a,
    transport,
    { upload },
    () => new Date(f.time),
  ).process(f.scope.storeId);
  expect(upload).not.toHaveBeenCalled();
  const sourceIds = f.db
    .prepare("SELECT id FROM source_documents ORDER BY id")
    .all();
  const receipt = new WasteReceiptRepository(f.a),
    summary = await receipt.sourceSummary(
      f.scope.storeId,
      refs[0]!.sourceDocumentId,
    );
  await receipt.confirmWasteDate(summary!.receipt.id, "2026-10-16");
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  offline = false;
  const queue = new SourceUploadQueue(
    a,
    transport,
    { upload },
    () => new Date("2026-10-18T18:05:00.000Z"),
  );
  await queue.process(f.scope.storeId);
  await queue.process(f.scope.storeId);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(new Set(completed)).toEqual(
    new Set(refs.map((r) => r.sourceDocumentId)),
  );
  expect(inits).toHaveLength(4);
  expect(
    db.prepare("SELECT id FROM source_documents ORDER BY id").all(),
  ).toEqual(sourceIds);
  const local = new WasteReceiptRepository(a);
  expect(
    await local.sourceSummary(f.scope.storeId, refs[0]!.sourceDocumentId),
  ).toMatchObject({
    lineCount: 1,
    receipt: { aiStatus: "COMPLETED", confirmedWasteDate: "2026-10-16" },
    uploadJob: { status: "COMPLETED" },
  });
  expect(db.prepare("SELECT COUNT(*) n FROM waste_observations").get()).toEqual(
    { n: 0 },
  );
  const controller = new CopilotLocalChatController(
    new CopilotConversationRepository(a, f.scope),
    f.scope,
    randomUUID,
    () => f.time,
  );
  expect((await controller.send(f.conversation.id)).attachments).toEqual(refs);
});
