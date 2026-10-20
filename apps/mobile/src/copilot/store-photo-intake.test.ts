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
import {
  CopilotStorePhotoIntake,
  type StorePhotoIntakeStorage,
} from "./store-photo-intake";
import { SourceUploadQueue } from "../documents/source-upload-queue";
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
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-store-photos-"));
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
    at = "2026-10-20T12:00:00.000Z";
  const repo = new CopilotConversationRepository(a, scope),
    controller = new CopilotLocalChatController(
      repo,
      scope,
      randomUUID,
      () => at,
    ),
    conversation = await controller.create();
  await controller.editText(conversation.id, "Que penses-tu de mon rayon ?");
  const assets = [1, 2, 3].map((i) => {
    const path = join(dir, `original-${i}.jpg`);
    writeFileSync(path, Buffer.from([255, 216, 255, i, 255, 217]));
    return {
      uri: pathToFileURL(path).href,
      filename: `Rayon ${i}.jpg`,
      mimeType: "image/jpeg" as const,
    };
  });
  const copies: string[] = [],
    storage: StorePhotoIntakeStorage = {
      size: vi.fn(async (uri) => readFileSync(fileURLToPath(uri)).length),
      retain: vi.fn(async (asset, id) => {
        const destination = join(dir, `copy-${id}.jpg`);
        copyFileSync(fileURLToPath(asset.uri), destination);
        copies.push(destination);
        const bytes = readFileSync(destination);
        return {
          localUri: pathToFileURL(destination).href,
          mimeType: asset.mimeType,
          sizeBytes: bytes.length,
          checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        };
      }),
    },
    authority = {
      canCapture: () => true,
      signal: new AbortController().signal,
    };
  return {
    dir,
    path,
    db,
    a,
    scope,
    at,
    repo,
    controller,
    conversation,
    assets,
    copies,
    storage,
    authority,
    intake: new CopilotStorePhotoIntake(
      a,
      scope,
      randomUUID,
      storage,
      () => at,
    ),
  };
}
it("atomically retains the photo draft and existing upload job across restart, with no receipt or business observation", async () => {
  const f = await fixture(),
    result = await f.intake.capture(
      f.conversation.id,
      { assets: f.assets },
      f.authority,
      3,
    );
  expect(result).toMatchObject({
    imported: 3,
    failures: [],
    draft: { text: "Que penses-tu de mon rayon ?" },
  });
  expect(
    f.db
      .prepare(
        "SELECT source_type,remote_upload_status,local_processing_status FROM source_documents",
      )
      .all(),
  ).toEqual(
    Array.from({ length: 3 }, () => ({
      source_type: "STORE_PHOTO",
      remote_upload_status: "PENDING",
      local_processing_status: "VALIDATED",
    })),
  );
  expect(f.db.prepare("SELECT type,status FROM local_jobs").all()).toEqual(
    Array.from({ length: 3 }, () => ({
      type: "SOURCE_UPLOAD_AND_REGISTER",
      status: "PENDING",
    })),
  );
  for (const table of [
    "waste_receipts",
    "waste_observations",
    "source_records",
  ])
    expect(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  f.db.close();
  const reopened = new DatabaseSync(f.path);
  dbs.push(reopened);
  expect(
    await new CopilotConversationRepository(
      new ReceiptTestDatabase(reopened),
      f.scope,
    ).draft(f.conversation.id),
  ).toEqual(result.draft);
  for (const [i, asset] of f.assets.entries())
    expect(readFileSync(fileURLToPath(asset.uri))).toEqual(
      readFileSync(f.copies[i]!),
    );
});
it.each(["commit", "cancel", "role"])(
  "preserves originals and rolls back source, job and attachment on %s failure",
  async (mode) => {
    const f = await fixture(),
      abort = new AbortController();
    let allowed = true;
    if (mode === "commit") f.a.fail = true;
    else {
      const retain = f.storage.retain;
      f.storage.retain = vi.fn(async (asset, id) => {
        const file = await retain(asset, id);
        if (mode === "cancel") abort.abort();
        else allowed = false;
        return file;
      });
    }
    const capture = f.intake.capture(
      f.conversation.id,
      { assets: [f.assets[0]!] },
      { signal: abort.signal, canCapture: () => allowed },
      3,
    );
    if (mode === "commit")
      expect(await capture).toMatchObject({
        imported: 0,
        failures: [{ code: "STORE_PHOTO_NOT_SAVED" }],
      });
    else
      await expect(capture).rejects.toThrow(
        mode === "cancel"
          ? "COPILOT_ATTACHMENT_CANCELLED"
          : "STORE_PHOTO_CAPTURE_FORBIDDEN",
      );
    for (const table of ["source_documents", "local_files", "local_jobs"])
      expect(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    expect((await f.repo.draft(f.conversation.id))?.attachments).toEqual([]);
    expect(existsSync(fileURLToPath(f.assets[0]!.uri))).toBe(true);
    expect(f.copies.every(existsSync)).toBe(true);
  },
);
it("checks private conversation, batch size and existing photo capacity before copying", async () => {
  const f = await fixture(),
    foreign = new CopilotStorePhotoIntake(
      f.a,
      { ...f.scope, ownerId: randomUUID() },
      randomUUID,
      f.storage,
    );
  await expect(
    foreign.capture(
      f.conversation.id,
      { assets: [f.assets[0]!] },
      f.authority,
      3,
    ),
  ).rejects.toThrow();
  expect(f.storage.retain).not.toHaveBeenCalled();
  await f.intake.capture(
    f.conversation.id,
    { assets: f.assets },
    f.authority,
    3,
  );
  expect(await f.intake.capacity(f.conversation.id)).toBe(0);
  await expect(
    f.intake.capture(
      f.conversation.id,
      { assets: [f.assets[0]!] },
      f.authority,
      1,
    ),
  ).rejects.toThrow("STORE_PHOTO_TURN_LIMIT");
  expect(f.storage.retain).toHaveBeenCalledTimes(3);
});
it("uploads each immutable source once through the shared queue without extraction or publication", async () => {
  const f = await fixture();
  const result = await f.intake.capture(
      f.conversation.id,
      { assets: [f.assets[0]!] },
      f.authority,
      3,
    ),
    sourceDocumentId = result.draft!.attachments[0]!.sourceDocumentId,
    uploadId = randomUUID();
  const init = vi.fn(async () => ({
    uploadId,
    objectKey: "private-photo",
    status: "UPLOAD_REQUIRED" as const,
    uploadUrl: "https://upload.invalid/photo",
    expiresAt: "2026-10-20T13:00:00.000Z",
    headers: {},
  }));
  const complete = vi.fn(async () => ({
    sourceDocumentId,
    remoteUploadStatus: "CONFIRMED" as const,
    remoteProcessingStatus: "UPLOADED" as const,
    jobId: null,
    wasteReceiptDraft: null,
  }));
  const upload = vi.fn(async () => undefined),
    queue = new SourceUploadQueue(
      f.a,
      {
        init,
        complete,
        verify: vi.fn(async () => {
          throw Error("Photo must not verify Mercalys");
        }),
      },
      { upload },
      () => new Date("2026-10-20T12:01:00.000Z"),
    );
  await queue.process(f.scope.storeId);
  await queue.process(f.scope.storeId);
  expect(init).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(init.mock.calls[0]).toMatchObject([
    f.scope.storeId,
    { sourceType: "STORE_PHOTO", sourceDocumentId },
  ]);
  expect(
    f.db
      .prepare("SELECT remote_upload_status,sync_state FROM source_documents")
      .get(),
  ).toEqual({ remote_upload_status: "CONFIRMED", sync_state: "SYNCED" });
  expect(f.db.prepare("SELECT type,status FROM local_jobs").all()).toEqual([
    { type: "SOURCE_UPLOAD_AND_REGISTER", status: "COMPLETED" },
  ]);
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 0,
  });
});
