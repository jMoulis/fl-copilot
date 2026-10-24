import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { get } from "@vercel/blob";
import { sourceObjectKey } from "../src/uploads/source-upload-service";
import {
  normalizeStorePhoto,
  readStorePhoto,
  readOwnedStorePhotoSource,
  readPrivateStorePhoto,
} from "../src/copilot/store-photo-reader";
vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  get: vi.fn(),
}));
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function fixture() {
  const scope = { storeId: randomUUID(), ownerId: randomUUID() },
    sourceDocumentId = randomUUID(),
    bytes = new Uint8Array(
      await sharp({
        create: { width: 32, height: 24, channels: 3, background: "#e87c35" },
      })
        .png()
        .toBuffer(),
    ),
    input = {
      sourceDocumentId,
      sourceType: "STORE_PHOTO" as const,
      filename: "rayon.png",
      mimeType: "image/png" as const,
      sizeBytes: bytes.length,
      checksum: hash(bytes),
    },
    key = sourceObjectKey(scope.storeId, input),
    source = {
      _id: sourceDocumentId,
      storeId: scope.storeId,
      sourceType: input.sourceType,
      originalFilename: input.filename,
      checksum: input.checksum,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      objectKey: key,
      createdAt: new Date("2026-10-20T12:00:00Z"),
      remoteUploadStatus: "CONFIRMED",
      deletedAt: null,
    },
    upload = {
      ...input,
      storeId: scope.storeId,
      userId: scope.ownerId,
      objectKey: key,
      status: "CONFIRMED",
    };
  const rows: Record<string, Record<string, unknown>[]> = {
    sourceDocuments: [source],
    sourceUploads: [upload],
  };
  const db = {
    collection: (name: string) => ({
      findOne: async (query: Record<string, unknown>) =>
        rows[name]?.find((row) =>
          Object.entries(query).every(([k, v]) =>
            v === null ? row[k] == null : row[k] === v,
          ),
        ) ?? null,
    }),
  } as unknown as Db;
  const read = vi.fn(async () => bytes.slice());
  return { scope, input, source, upload, bytes, key, db, read };
}
it("binds verified pixels to an owned immutable source without exporting private paths or URLs", async () => {
  const f = await fixture(),
    result = await readStorePhoto(
      f.db,
      f.scope,
      { sourceDocumentId: f.input.sourceDocumentId },
      f.read,
    );
  expect(result.snapshot).toMatchObject({
    status: "AVAILABLE",
    source: { checksum: f.input.checksum },
    frame: { mimeType: "image/jpeg", width: 32, height: 24 },
  });
  expect(f.read).toHaveBeenCalledWith(f.key, f.bytes.length, undefined);
  expect(await sharp(result.image).metadata()).toMatchObject({
    format: "jpeg",
    width: 32,
    height: 24,
  });
  expect(hash(result.image)).toBe(result.snapshot.frame.checksum);
  expect(JSON.stringify(result.snapshot)).not.toContain(f.key);
  expect(JSON.stringify(result.snapshot)).not.toContain("blobUrl");
  expect(result.snapshot.evidence[0]!.factKind).toBe("QUALITY");
  expect(hash(f.bytes)).toBe(f.input.checksum);
});
it.each([
  "FOREIGN_STORE",
  "FOREIGN_OWNER",
  "RECEIPT",
  "PENDING",
  "DELETED",
  "KEY_CHANGED",
  "UPLOAD_CHANGED",
])("refuses %s before any binary read", async (mode) => {
  const f = await fixture();
  if (mode === "FOREIGN_STORE") f.scope.storeId = randomUUID();
  if (mode === "FOREIGN_OWNER") f.scope.ownerId = randomUUID();
  if (mode === "RECEIPT") f.source.sourceType = "WASTE_RECEIPT" as never;
  if (mode === "PENDING") f.source.remoteUploadStatus = "PENDING";
  if (mode === "DELETED") f.source.deletedAt = new Date() as never;
  if (mode === "KEY_CHANGED")
    f.source.objectKey = `sources/${randomUUID()}/foreign`;
  if (mode === "UPLOAD_CHANGED") f.upload.checksum = `sha256:${"b".repeat(64)}`;
  await expect(
    readStorePhoto(
      f.db,
      f.scope,
      { sourceDocumentId: f.input.sourceDocumentId },
      f.read,
    ),
  ).rejects.toThrow(/STORE_PHOTO_/);
  expect(f.read).not.toHaveBeenCalled();
});
it("refuses missing/corrupt bytes and a source withdrawn during reading", async () => {
  const f = await fixture(),
    input = { sourceDocumentId: f.input.sourceDocumentId };
  await expect(
    readStorePhoto(f.db, f.scope, input, async () => null),
  ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
  await expect(
    readStorePhoto(f.db, f.scope, input, async () =>
      new Uint8Array(f.bytes.length).fill(1),
    ),
  ).rejects.toThrow("STORE_PHOTO_INVALID");
  await expect(
    readStorePhoto(f.db, f.scope, input, async () => {
      f.source.remoteUploadStatus = "INVALID";
      return f.bytes;
    }),
  ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
});
it("orients a JPEG and strips EXIF while preserving original bytes", async () => {
  const bytes = new Uint8Array(
      await sharp({
        create: { width: 32, height: 24, channels: 3, background: "#226633" },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    ),
    checksum = hash(bytes),
    result = await normalizeStorePhoto(bytes, {
      checksum,
      sizeBytes: bytes.length,
      mimeType: "image/jpeg",
    });
  expect(result.frame).toMatchObject({ width: 24, height: 32 });
  const meta = await sharp(result.image).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
  expect(hash(bytes)).toBe(checksum);
});
it("rejects a mismatched MIME and excessive declared pixels", async () => {
  const f = await fixture();
  await expect(
    normalizeStorePhoto(f.bytes, {
      checksum: f.input.checksum,
      sizeBytes: f.bytes.length,
      mimeType: "image/jpeg",
    }),
  ).rejects.toThrow("STORE_PHOTO_INVALID");
  const huge = new Uint8Array(
    await sharp({
      create: { width: 6001, height: 6000, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer(),
  );
  await expect(
    normalizeStorePhoto(huge, {
      checksum: hash(huge),
      sizeBytes: huge.length,
      mimeType: "image/png",
    }),
  ).rejects.toThrow("STORE_PHOTO_INVALID");
});
it("cancels before reading and bounds a private stream instead of buffering an oversized object", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    readPrivateStorePhoto("not-read", 100, abort.signal),
  ).rejects.toThrow("STORE_PHOTO_READ_CANCELLED");
  expect(get).not.toHaveBeenCalled();
  const cancelled = vi.fn();
  vi.mocked(get).mockResolvedValueOnce({
    statusCode: 200,
    stream: new ReadableStream(
      {
        pull(c) {
          c.enqueue(new Uint8Array(64));
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    ),
  } as never);
  await expect(readPrivateStorePhoto("owned-test-source", 100)).rejects.toThrow(
    "STORE_PHOTO_INVALID",
  );
  expect(cancelled).toHaveBeenCalledOnce();
});

it("prepares only owned source metadata without retrieving or normalizing pixels", async () => {
  const f = await fixture();
  const result = await readOwnedStorePhotoSource(f.db, f.scope, {
    sourceDocumentId: f.input.sourceDocumentId,
  });
  expect(result.checksum).toBe(f.input.checksum);
  expect(f.read).not.toHaveBeenCalled();
  f.upload.userId = randomUUID();
  await expect(
    readOwnedStorePhotoSource(f.db, f.scope, {
      sourceDocumentId: f.input.sourceDocumentId,
    }),
  ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
});
