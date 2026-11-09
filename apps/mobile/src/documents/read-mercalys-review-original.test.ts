import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { readMercalysReviewOriginal } from "./read-mercalys-review-original";
const files = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./read-retained-mercalys", () => ({
  readRetainedMercalysBytes: files.read,
}));
const databases: DatabaseSync[] = [];
const bytes = new Uint8Array([1, 2, 3]).slice(),
  checksum = `sha256:${"a".repeat(64)}`;
const missing = () =>
  Object.assign(new Error("private-path"), { code: "ENOENT" });
beforeEach(() => {
  files.read.mockReset().mockRejectedValue(missing());
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function setup() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const db = new VisualTestDatabase(raw);
  await runLocalMigrations(db);
  const storeId = randomUUID(),
    sourceId = randomUUID();
  await db.runAsync(
    `INSERT INTO source_documents(id,store_id,source_type,checksum,local_file_uri,local_processing_status,remote_upload_status,version,created_at,updated_at) VALUES(?,?,'MERCALYS_SALES',?,'file:///published.xlsx','PUBLISHED','CONFIRMED',1,'2026-11-08T12:00:00Z','2026-11-08T12:00:00Z')`,
    sourceId,
    storeId,
    checksum,
  );
  return {
    raw,
    db,
    storeId,
    sourceId,
    originals: {
      recover: vi.fn(async () => ({
        localUri: "file:///recovered.xlsx",
        views: null,
      })),
    },
  };
}
it("keeps an available batch copy entirely local without a lookup or recovery", async () => {
  files.read.mockResolvedValue(bytes);
  const s = await setup(),
    lookup = vi.spyOn(s.db, "getFirstAsync");
  expect(
    await readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).toEqual(bytes);
  expect(lookup).not.toHaveBeenCalled();
  expect(s.originals.recover).not.toHaveBeenCalled();
});
it("reads the already-published local copy offline when the batch copy is gone", async () => {
  const s = await setup(),
    before = s.raw.prepare("SELECT * FROM source_documents").all();
  files.read.mockImplementation(async (uri) => {
    if (uri === "file:///published.xlsx") return bytes;
    throw missing();
  });
  expect(
    await readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).toEqual(bytes);
  expect(s.originals.recover).not.toHaveBeenCalled();
  expect(s.raw.prepare("SELECT * FROM source_documents").all()).toEqual(before);
  expect(
    s.raw.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
  ).toMatchObject({ count: 0 });
});
it("recovers the same scoped source only when both existing copies are missing", async () => {
  const s = await setup();
  files.read.mockImplementation(async (uri) => {
    if (uri === "file:///recovered.xlsx") return bytes;
    throw missing();
  });
  expect(
    await readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).toEqual(bytes);
  expect(s.originals.recover).toHaveBeenCalledExactlyOnceWith(s.sourceId);
});
it.each(["store", "checksum", "deleted", "type"])(
  "does not recover another %s binding by filename or URI",
  async (change) => {
    const s = await setup();
    if (change === "store")
      await s.db.runAsync(
        "UPDATE source_documents SET store_id=?",
        randomUUID(),
      );
    if (change === "checksum")
      await s.db.runAsync(
        "UPDATE source_documents SET checksum=?",
        `sha256:${"b".repeat(64)}`,
      );
    if (change === "deleted")
      await s.db.runAsync(
        "UPDATE source_documents SET deleted_at='2026-11-09T00:00:00Z'",
      );
    if (change === "type")
      await s.db.runAsync(
        "UPDATE source_documents SET source_type='STORE_PHOTO'",
      );
    await expect(
      readMercalysReviewOriginal(
        "file:///batch.xlsx",
        checksum,
        s.storeId,
        s.db,
        s.originals,
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(s.originals.recover).not.toHaveBeenCalled();
  },
);
it("preserves transient storage failures rather than replacing the file or downloading again", async () => {
  const s = await setup(),
    busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
  files.read.mockRejectedValue(busy);
  await expect(
    readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).rejects.toBe(busy);
  expect(s.originals.recover).not.toHaveBeenCalled();
});
it("retains a failed recovery for an explicit retry without creating business work", async () => {
  const s = await setup();
  s.originals.recover.mockRejectedValueOnce(new TypeError("offline"));
  await expect(
    readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).rejects.toMatchObject({ message: "MERCALYS_ORIGINAL_RECOVERY_FAILED" });
  files.read.mockImplementation(async (uri) => {
    if (uri === "file:///recovered.xlsx") return bytes;
    throw missing();
  });
  expect(
    await readMercalysReviewOriginal(
      "file:///batch.xlsx",
      checksum,
      s.storeId,
      s.db,
      s.originals,
    ),
  ).toEqual(bytes);
  expect(s.originals.recover).toHaveBeenCalledTimes(2);
  expect(
    s.raw.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
  ).toMatchObject({ count: 0 });
});
