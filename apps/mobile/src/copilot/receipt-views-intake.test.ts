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
import {
  RECEIPT_PHOTO_BUNDLE_MIME,
  type CopilotReceiptViewsSelection,
} from "@fl-copilot/domain";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import { readReceiptPhotoViews } from "../documents/receipt-photo-views";
import {
  CopilotReceiptViewsIntake,
  type ReceiptViewsIntakeStorage,
} from "./receipt-views-intake";
const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
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
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-receipt-views-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  // Start with an existing v44 chat to prove migration preserves previous state.
  await runLocalMigrations(a, localMigrations.slice(0, 44));
  const scope = {
      storeId: randomUUID(),
      ownerId: randomUUID(),
      deviceId: randomUUID(),
    },
    time = "2026-10-18T12:00:00Z";
  const repo = new CopilotConversationRepository(a, scope),
    controller = new CopilotLocalChatController(
      repo,
      scope,
      randomUUID,
      () => time,
    );
  const conversation = await controller.create();
  await controller.editText(conversation.id, "Analyse ce long ticket");
  const beforeMigration = db.prepare("SELECT * FROM copilot_drafts").all();
  await runLocalMigrations(a);
  expect(db.prepare("SELECT * FROM copilot_drafts").all()).toEqual(
    beforeMigration,
  );
  const assets = [1, 2, 3].map((n) => {
    const path = join(dir, `selected-${n}.jpg`);
    writeFileSync(path, Buffer.from([255, 216, n, 255, 217]));
    return {
      uri: pathToFileURL(path).href,
      filename: `Vue ${n}.jpg`,
      mimeType: "image/jpeg" as const,
    };
  });
  const retained: string[] = [];
  const storage: ReceiptViewsIntakeStorage = {
    size: vi.fn(async (uri) => readFileSync(fileURLToPath(uri)).length),
    retain: vi.fn(async (asset, id) => {
      const path = join(dir, `retained-${id}.jpg`);
      copyFileSync(fileURLToPath(asset.uri), path);
      retained.push(path);
      const bytes = readFileSync(path);
      return {
        localUri: pathToFileURL(path).href,
        sizeBytes: bytes.length,
        mimeType: "image/jpeg",
        checksum: checksum(bytes),
      };
    }),
    read: vi.fn(async (uri) => {
      const bytes = readFileSync(fileURLToPath(uri));
      return {
        dataBase64: bytes.toString("base64"),
        sizeBytes: bytes.length,
        checksum: checksum(bytes),
      };
    }),
    writeBundle: vi.fn(async (text, id) => {
      const path = join(dir, `${id}.flreceipt`);
      writeFileSync(path, text, { flag: "wx" });
      retained.push(path);
      const bytes = readFileSync(path);
      return {
        localUri: pathToFileURL(path).href,
        sizeBytes: bytes.length,
        checksum: checksum(bytes),
        mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      };
    }),
  };
  const intake = new CopilotReceiptViewsIntake(
    a,
    scope,
    randomUUID,
    storage,
    () => time,
  );
  const input: CopilotReceiptViewsSelection = {
    mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
    assets,
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
    assets,
    retained,
    storage,
    intake,
    input,
    authority: { canCapture: () => true, signal: new AbortController().signal },
  };
}
it("retains ordered originals, one canonical ticket/upload/attachment and its local manifest across restart without publishing", async () => {
  const f = await fixture(),
    before = f.db.prepare("SELECT * FROM sync_outbox").all();
  const result = await f.intake.capture(
    f.conversation.id,
    { ...f.input, assets: [...f.assets].reverse() },
    f.authority,
    1,
  );
  expect(result).toMatchObject({
    imported: 1,
    failures: [],
    draft: { text: "Analyse ce long ticket" },
  });
  expect(result.draft?.attachments).toHaveLength(1);
  const id = result.draft!.attachments[0]!.sourceDocumentId;
  const group = await readReceiptPhotoViews(f.a, f.scope.storeId, id);
  expect(group).toMatchObject({ grouped: true });
  expect(group?.views).toHaveLength(3);
  const row = f.db
    .prepare("SELECT local_uri FROM local_files WHERE source_document_id=?")
    .get(id) as { local_uri: string };
  const bundle = JSON.parse(readFileSync(fileURLToPath(row.local_uri), "utf8"));
  expect(bundle.views.map((v: { dataBase64: string }) => v.dataBase64)).toEqual(
    [...f.assets]
      .reverse()
      .map((a) => readFileSync(fileURLToPath(a.uri)).toString("base64")),
  );
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 1,
  });
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(f.db.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM waste_observations").get(),
  ).toEqual({ n: 0 });
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  expect(
    await new CopilotConversationRepository(a, f.scope).draft(
      f.conversation.id,
    ),
  ).toEqual(result.draft);
  expect(await readReceiptPhotoViews(a, f.scope.storeId, id)).toEqual(group);
  for (const asset of f.assets)
    expect(existsSync(fileURLToPath(asset.uri))).toBe(true);
  for (const path of f.retained) expect(existsSync(path)).toBe(true);
});
it("deduplicates the same ordered bytes despite renamed gallery files and different private-copy paths", async () => {
  const f = await fixture();
  await f.intake.capture(f.conversation.id, f.input, f.authority, 10);
  const result = await f.intake.capture(
    f.conversation.id,
    {
      ...f.input,
      assets: f.assets.map((asset) => ({ ...asset, filename: "renamed.jpg" })),
    },
    f.authority,
    10,
  );
  const summary = await new WasteReceiptRepository(f.a).sourceSummary(
    f.scope.storeId,
    result.draft!.attachments[1]!.sourceDocumentId,
  );
  expect(summary?.receipt.duplicateStatus).toBe("POSSIBLE_DUPLICATE");
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
      )
      .get(),
  ).toEqual({ n: 1 });
  await new WasteReceiptRepository(f.a).resolveExactDuplicate(
    summary!.receipt.id,
    "KEEP_BOTH",
    randomUUID(),
    f.time,
  );
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
      )
      .get(),
  ).toEqual({ n: 2 });
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM waste_receipt_photo_groups").get(),
  ).toEqual({ n: 2 });
});
it.each([
  "cancel before",
  "cancel copy",
  "cancel binding",
  "role before",
  "role commit",
  "commit failure",
  "read drift",
  "group write failure",
])("keeps originals and rolls back the entire group on %s", async (why) => {
  const f = await fixture(),
    abort = new AbortController();
  let allowed = true;
  if (why === "cancel before") abort.abort();
  if (why === "role before") allowed = false;
  if (why === "cancel copy") {
    const retain = f.storage.retain;
    f.storage.retain = async (...args) => {
      const value = await retain(...args);
      abort.abort();
      return value;
    };
  }
  if (why === "role commit")
    f.a.afterRun = (sql) => {
      if (sql.includes("INTO waste_receipt_photo_groups")) allowed = false;
    };
  if (why === "cancel binding")
    f.a.afterRun = (sql) => {
      if (sql.includes("INTO copilot_drafts")) abort.abort();
    };
  if (why === "commit failure") f.a.fail = true;
  if (why === "read drift")
    f.storage.read = async () => ({
      dataBase64: "AQ==",
      sizeBytes: 1,
      checksum: `sha256:${"a".repeat(64)}`,
    });
  if (why === "group write failure")
    f.storage.writeBundle = async () => {
      throw Error("write failed");
    };
  const before = f.db.prepare("SELECT * FROM sync_outbox").all();
  await expect(
    f.intake.capture(
      f.conversation.id,
      f.input,
      { canCapture: () => allowed, signal: abort.signal },
      10,
    ),
  ).rejects.toThrow();
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 0,
  });
  expect(
    f.db.prepare("SELECT COUNT(*) n FROM waste_receipt_photo_groups").get(),
  ).toEqual({ n: 0 });
  expect((await f.repo.draft(f.conversation.id))?.attachments).toHaveLength(0);
  expect(f.db.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
  for (const asset of f.assets)
    expect(existsSync(fileURLToPath(asset.uri))).toBe(true);
  for (const path of f.retained) expect(existsSync(path)).toBe(true);
});
it("refuses foreign owners, stale group metadata and missing linkage without exposing other-store photos", async () => {
  const f = await fixture();
  const foreign = new CopilotReceiptViewsIntake(
    f.a,
    { ...f.scope, ownerId: randomUUID() },
    randomUUID,
    f.storage,
  );
  await expect(
    foreign.capture(f.conversation.id, f.input, f.authority, 10),
  ).rejects.toThrow();
  const result = await f.intake.capture(
      f.conversation.id,
      f.input,
      f.authority,
      10,
    ),
    id = result.draft!.attachments[0]!.sourceDocumentId;
  expect(await readReceiptPhotoViews(f.a, randomUUID(), id)).toBeNull();
  await f.controller.removeAttachment(f.conversation.id, id);
  f.db
    .prepare(
      "UPDATE waste_receipt_photo_groups SET checksum=? WHERE source_document_id=?",
    )
    .run(`sha256:${"f".repeat(64)}`, id);
  expect(
    (await readReceiptPhotoViews(f.a, f.scope.storeId, id))?.views,
  ).toHaveLength(0);
  await expect(
    f.repo.attachReceiptPhotos(f.conversation.id, [id], f.time),
  ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
});
it.each(["one", "six", "empty slot", "oversize", "total", "repeated photo"])(
  "blocks %s before creating a canonical group",
  async (why) => {
    const f = await fixture();
    let assets = f.assets;
    if (why === "one") assets = assets.slice(0, 1);
    if (why === "six") assets = [...assets, ...assets];
    if (why === "oversize") f.storage.size = async () => 21 * 1024 * 1024;
    if (why === "total") f.storage.size = async () => 20 * 1024 * 1024;
    if (why === "repeated photo") assets = [f.assets[0]!, f.assets[0]!];
    await expect(
      f.intake.capture(
        f.conversation.id,
        { ...f.input, assets },
        f.authority,
        why === "empty slot" ? 0 : 10,
      ),
    ).rejects.toThrow();
    expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual(
      { n: 0 },
    );
  },
);

it("resumes one normal upload after offline restart, retains photo provenance and blocks ambiguous analysis without a retry loop", async () => {
  const { SourceUploadQueue } =
    await import("../documents/source-upload-queue");
  const { ApiClientError } = await import("@fl-copilot/api-client");
  const { receiptProcessingPresentation } =
    await import("../documents/waste-receipt-processing");
  const f = await fixture(),
    result = await f.intake.capture(
      f.conversation.id,
      f.input,
      f.authority,
      10,
    );
  const id = result.draft!.attachments[0]!.sourceDocumentId;
  let offline = true;
  const transport = {
    init: vi.fn(
      async (
        _store: string,
        input: { sourceDocumentId: string; mimeType: string },
      ) => {
        expect(input).toMatchObject({
          sourceDocumentId: id,
          mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
        });
        if (offline)
          throw new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Hors connexion",
            retryable: true,
          });
        return {
          uploadId: id,
          objectKey: "private/bundle",
          status: "UPLOAD_REQUIRED" as const,
          uploadUrl: "https://private.invalid/upload",
          headers: {},
          expiresAt: null,
        };
      },
    ),
    complete: vi.fn(async () => {
      throw new ApiClientError(422, {
        code: "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
        messageFr: "Photos à examiner",
        retryable: false,
      });
    }),
    verify: vi.fn(),
  };
  const upload = vi.fn(async (input: { localUri: string }) => {
    const json = JSON.parse(
      readFileSync(fileURLToPath(input.localUri), "utf8"),
    );
    expect(json.mode).toBe("ONE_RECEIPT_MULTIPLE_PHOTOS");
    expect(json.views).toHaveLength(3);
  });
  await new SourceUploadQueue(
    f.a,
    transport,
    { upload },
    () => new Date(f.time),
  ).process(f.scope.storeId);
  expect(upload).not.toHaveBeenCalled();
  const group = await readReceiptPhotoViews(f.a, f.scope.storeId, id);
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const a = new ReceiptTestDatabase(db);
  offline = false;
  const queue = new SourceUploadQueue(
    a,
    transport,
    { upload },
    () => new Date("2026-10-18T12:05:00Z"),
  );
  await queue.process(f.scope.storeId);
  await queue.process(f.scope.storeId);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(transport.complete).toHaveBeenCalledTimes(1);
  expect(await readReceiptPhotoViews(a, f.scope.storeId, id)).toEqual(group);
  const repo = new WasteReceiptRepository(a),
    summary = await repo.sourceSummary(f.scope.storeId, id);
  expect(summary?.uploadJob).toMatchObject({
    status: "FAILED",
    lastError: "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
  });
  expect(
    receiptProcessingPresentation(
      summary!.receipt,
      summary!.uploadJob,
      0,
      false,
    ),
  ).toMatchObject({ title: "Photos à examiner", canRetry: false });
  await expect(repo.retryProcessing(summary!.receipt.id)).rejects.toThrow(
    "WASTE_RECEIPT_RETRY_UNAVAILABLE",
  );
  expect(db.prepare("SELECT COUNT(*) n FROM waste_observations").get()).toEqual(
    { n: 0 },
  );
});
