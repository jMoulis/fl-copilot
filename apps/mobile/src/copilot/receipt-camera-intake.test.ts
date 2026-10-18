import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { RECEIPT_PHOTO_BUNDLE_MIME } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";
import { ReceiptCameraSession } from "./receipt-camera-session";
import { CopilotReceiptCameraIntake } from "./receipt-camera-intake";
import { readReceiptPhotoViews } from "../documents/receipt-photo-views";
import type { ReceiptViewsIntakeStorage } from "./receipt-views-intake";
const dbs: DatabaseSync[] = [],
  dirs: string[] = [];
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
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fl-camera-"));
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
  };
  const repo = new CopilotConversationRepository(a, scope),
    time = "2026-10-18T16:00:00Z";
  const controller = new CopilotLocalChatController(
    repo,
    scope,
    randomUUID,
    () => time,
  );
  const conversation = await controller.create();
  await controller.editText(conversation.id, "Aide-moi à vérifier ce ticket");
  const photos = [1, 2, 3].map((n) => {
    const path = join(dir, `camera-${n}.jpg`);
    writeFileSync(path, Buffer.from([255, 216, 255, n, 255, 217]));
    return {
      uri: pathToFileURL(path).href,
      width: 1200,
      height: 2400,
      format: "jpg" as const,
    };
  });
  const retained: string[] = [];
  const storage: ReceiptViewsIntakeStorage = {
    size: async (uri) => readFileSync(fileURLToPath(uri)).length,
    retain: async (asset, id) => {
      const path = join(dir, `${id}.jpg`);
      copyFileSync(fileURLToPath(asset.uri), path);
      retained.push(path);
      const bytes = readFileSync(path);
      return {
        localUri: pathToFileURL(path).href,
        checksum: checksum(bytes),
        sizeBytes: bytes.length,
        mimeType: "image/jpeg",
      };
    },
    read: async (uri) => {
      const bytes = readFileSync(fileURLToPath(uri));
      return {
        dataBase64: bytes.toString("base64"),
        checksum: checksum(bytes),
        sizeBytes: bytes.length,
      };
    },
    writeBundle: async (text, id) => {
      const path = join(dir, `${id}.flreceipt`);
      writeFileSync(path, text, { flag: "wx" });
      retained.push(path);
      const bytes = readFileSync(path);
      return {
        localUri: pathToFileURL(path).href,
        checksum: checksum(bytes),
        sizeBytes: bytes.length,
        mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      };
    },
  };
  let allowed = true;
  const abort = new AbortController(),
    authority = { canCapture: () => allowed, signal: abort.signal };
  const intake = new CopilotReceiptCameraIntake(
    a,
    scope,
    randomUUID,
    storage,
    () => time,
  );
  const camera = () =>
    new ReceiptCameraSession(authority, (input) =>
      intake.capture(conversation.id, input, authority, 10),
    );
  return {
    path,
    db,
    a,
    scope,
    repo,
    controller,
    conversation,
    photos,
    retained,
    storage,
    intake,
    authority,
    abort,
    camera,
    revoke: () => {
      allowed = false;
    },
  };
}
it.each([1, 3])(
  "commits %i camera views as one receipt and one chat slot; preserves original bytes/text through restart",
  async (count) => {
    const f = await fixture(),
      session = f.camera(),
      before = f.db.prepare("SELECT * FROM sync_outbox").all();
    for (let i = 0; i < count; i++) {
      if (i) session.addView();
      await session.take(async () => f.photos[i]!);
    }
    expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual(
      { n: 0 },
    );
    if (count > 1) session.move(2, -1);
    const result = await session.save();
    await session.save();
    expect(result.draft).toMatchObject({
      text: "Aide-moi à vérifier ce ticket",
    });
    expect(result.draft?.attachments).toHaveLength(1);
    const sourceId = result.draft!.attachments[0]!.sourceDocumentId;
    expect(result.draft!.attachments[0]!.mediaType).toBe(
      count === 1 ? "image/jpeg" : RECEIPT_PHOTO_BUNDLE_MIME,
    );
    expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual(
      { n: 1 },
    );
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM waste_observations").get(),
    ).toEqual({ n: 0 });
    expect(f.db.prepare("SELECT * FROM sync_outbox").all()).toEqual(before);
    const file = f.db
      .prepare("SELECT local_uri FROM local_files WHERE source_document_id=?")
      .get(sourceId) as { local_uri: string };
    const bytes = readFileSync(fileURLToPath(file.local_uri));
    if (count === 1)
      expect(bytes).toEqual(readFileSync(fileURLToPath(f.photos[0]!.uri)));
    else
      expect(
        JSON.parse(bytes.toString()).views.map(
          (view: { checksum: string }) => view.checksum,
        ),
      ).toEqual(
        [0, 2, 1].map((i) =>
          checksum(readFileSync(fileURLToPath(f.photos[i]!.uri))),
        ),
      );
    f.db.close();
    const db = new DatabaseSync(f.path);
    dbs.push(db);
    const a = new ReceiptTestDatabase(db);
    expect(
      await new CopilotConversationRepository(a, f.scope).draft(
        f.conversation.id,
      ),
    ).toEqual(result.draft);
    const group = await readReceiptPhotoViews(a, f.scope.storeId, sourceId);
    expect(group).toMatchObject({ grouped: count > 1 });
    expect(group?.views).toHaveLength(count > 1 ? count : 0);
    for (const photo of f.photos)
      expect(existsSync(fileURLToPath(photo.uri))).toBe(true);
    for (const path of f.retained) expect(existsSync(path)).toBe(true);
  },
);
it.each(["role", "abort", "commit failure", "copy failure"])(
  "rolls back the camera ticket/private attachment on %s and retains all camera/cache/private files",
  async (why) => {
    const f = await fixture(),
      session = f.camera();
    await session.take(async () => f.photos[0]!);
    session.addView();
    await session.take(async () => f.photos[1]!);
    if (why === "role")
      f.a.afterRun = (sql) => {
        if (sql.includes("INTO waste_receipt_photo_groups")) f.revoke();
      };
    if (why === "abort")
      f.a.afterRun = (sql) => {
        if (sql.includes("INTO copilot_drafts")) f.abort.abort();
      };
    if (why === "commit failure") f.a.fail = true;
    if (why === "copy failure")
      f.storage.retain = async () => {
        throw Error("copy unavailable");
      };
    await expect(session.save()).rejects.toThrow();
    expect(session.snapshot()).toMatchObject({
      saved: false,
      busy: false,
      stage: "REVIEW",
    });
    expect(session.snapshot().views).toHaveLength(2);
    expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual(
      { n: 0 },
    );
    expect((await f.repo.draft(f.conversation.id))?.attachments).toHaveLength(
      0,
    );
    for (const photo of f.photos)
      expect(existsSync(fileURLToPath(photo.uri))).toBe(true);
    for (const path of f.retained) expect(existsSync(path)).toBe(true);
  },
);
it("pauses an exact duplicate camera image rather than enqueuing a second upload", async () => {
  const f = await fixture();
  for (let i = 0; i < 2; i++) {
    const session = f.camera();
    await session.take(async () => f.photos[0]!);
    await session.save();
  }
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 2,
  });
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM waste_receipts WHERE duplicate_status='POSSIBLE_DUPLICATE'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("rejects foreign conversations and a full draft without consuming or deleting camera photos", async () => {
  const f = await fixture();
  await expect(
    new CopilotReceiptCameraIntake(
      f.a,
      { ...f.scope, ownerId: randomUUID() },
      randomUUID,
      f.storage,
    ).capture(
      f.conversation.id,
      {
        mode: "ONE_RECEIPT_CAMERA",
        assets: [
          {
            uri: f.photos[0]!.uri,
            filename: "ticket.jpg",
            mimeType: "image/jpeg",
          },
        ],
      },
      f.authority,
      10,
    ),
  ).rejects.toThrow();
  await expect(
    f.intake.capture(
      f.conversation.id,
      {
        mode: "ONE_RECEIPT_CAMERA",
        assets: [
          {
            uri: f.photos[0]!.uri,
            filename: "ticket.jpg",
            mimeType: "image/jpeg",
          },
        ],
      },
      f.authority,
      0,
    ),
  ).rejects.toThrow("COPILOT_ATTACHMENT_LIMIT");
  expect(f.db.prepare("SELECT COUNT(*) n FROM waste_receipts").get()).toEqual({
    n: 0,
  });
  for (const photo of f.photos)
    expect(existsSync(fileURLToPath(photo.uri))).toBe(true);
});
