import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { serializeSourceOriginalMetadata } from "@fl-copilot/sync-contracts";
import { RECEIPT_PHOTO_BUNDLE_MIME } from "@fl-copilot/domain";
import { createSourceOriginalService } from "../src/uploads/source-original-service";
import { sourceObjectKey } from "../src/uploads/source-upload-service";

function fixture(sourceType = "STORE_PHOTO", mimeType = "image/jpeg") {
  const storeId = randomUUID(),
    actorId = randomUUID(),
    sourceId = randomUUID();
  const input = {
    sourceDocumentId: sourceId,
    sourceType,
    filename: "original",
    mimeType,
    sizeBytes: 1000,
    checksum: `sha256:${"a".repeat(64)}`,
  };
  const key = sourceObjectKey(storeId, input as never);
  const blob = {
    pathname: key,
    size: input.sizeBytes,
    contentType: mimeType,
    etag: "immutable-version",
    url: "https://test.private.blob.vercel-storage.com/original",
  };
  const source: Record<string, unknown> = {
    _id: sourceId,
    storeId,
    sourceType,
    originalFilename: input.filename,
    mimeType,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    objectKey: key,
    remoteUploadStatus: "CONFIRMED",
    createdAt: new Date("2026-10-20T12:00:00Z"),
    deletedAt: null,
    blobEtag: blob.etag,
  };
  const upload: Record<string, unknown> = {
    ...input,
    storeId,
    userId: actorId,
    objectKey: key,
    status: "CONFIRMED",
    blob: { ...blob },
  };
  const rows: Record<string, Record<string, unknown>[]> = {
    sourceDocuments: [source],
    sourceUploads: [upload],
  };
  const getDb = vi.fn(
    async () =>
      ({
        collection: (name: string) => ({
          findOne: vi.fn(
            async (query: Record<string, unknown>) =>
              rows[name]?.find((row) =>
                Object.entries(query).every(([k, v]) =>
                  v === null ? row[k] == null : row[k] === v,
                ),
              ) ?? null,
          ),
        }),
      }) as unknown as Db,
  );
  const head = vi.fn(async () => ({ ...blob }));
  const sign = vi.fn(async () => `${blob.url}?token=test-only`);
  const service = createSourceOriginalService(
    { getDb, checkHealth: async () => "connected", close: async () => {} },
    { head },
    sign,
    () => new Date("2026-10-20T13:00:00Z"),
  );
  return {
    storeId,
    actorId,
    sourceId,
    source,
    upload,
    blob,
    head,
    sign,
    service,
    key,
  };
}
it.each([
  ["STORE_PHOTO", "image/jpeg"],
  ["WASTE_RECEIPT", "image/png"],
  ["WASTE_RECEIPT", RECEIPT_PHOTO_BUNDLE_MIME],
  ["WEEKLY_COMMERCIAL_PDF", "application/pdf"],
  [
    "MERCALYS_SALES",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "MERCALYS_WASTE",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
])(
  "binds %s originals to verified immutable metadata without leaking private paths",
  async (type, mime) => {
    const f = fixture(type, mime),
      authorize = vi.fn(async () => {});
    const manifest = await f.service.manifest(
      f.storeId,
      f.actorId,
      f.sourceId,
      authorize,
    );
    const download = await f.service.download(
      f.storeId,
      f.actorId,
      f.sourceId,
      authorize,
    );
    expect(download.manifest).toEqual(manifest);
    const { manifestHash, ...metadata } = manifest;
    expect(manifestHash).toBe(
      `sha256:${createHash("sha256").update(serializeSourceOriginalMetadata(metadata)).digest("hex")}`,
    );
    expect(manifest).toMatchObject({
      sourceDocumentId: f.sourceId,
      access: type === "STORE_PHOTO" ? "OWNER" : "STORE",
      ownerId: type === "STORE_PHOTO" ? f.actorId : null,
    });
    expect(download.expiresAt).toBe("2026-10-20T13:02:00.000Z");
    expect(f.sign).toHaveBeenCalledWith(f.key, Date.parse(download.expiresAt));
    expect(JSON.stringify(manifest)).not.toContain(f.key);
    expect(JSON.stringify(manifest)).not.toContain("https:");
    expect(authorize).toHaveBeenCalledTimes(2);
  },
);
it("shares business documents within the authenticated store but keeps conversational photos private", async () => {
  const f = fixture("WEEKLY_COMMERCIAL_PDF", "application/pdf");
  await expect(
    f.service.manifest(f.storeId, randomUUID(), f.sourceId),
  ).resolves.toMatchObject({ access: "STORE" });
  const photo = fixture();
  await expect(
    photo.service.download(photo.storeId, randomUUID(), photo.sourceId),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(photo.head).not.toHaveBeenCalled();
  expect(photo.sign).not.toHaveBeenCalled();
});
it.each([
  "store",
  "source",
  "pending",
  "withdrawn",
  "upload",
  "key",
  "filename",
  "hash",
  "type",
  "etag",
  "blob",
  "registeredAt",
])("refuses %s mismatch before issuing a capability", async (mode) => {
  const f = fixture();
  if (mode === "store") f.storeId = randomUUID();
  if (mode === "source") f.sourceId = randomUUID();
  if (mode === "pending") f.source.remoteUploadStatus = "PENDING";
  if (mode === "withdrawn") f.source.deletedAt = new Date();
  if (mode === "upload") f.upload.status = "INVALID";
  if (mode === "key") f.upload.objectKey = "foreign-private-object";
  if (mode === "filename") f.source.originalFilename = "other";
  if (mode === "hash") f.upload.checksum = `sha256:${"b".repeat(64)}`;
  if (mode === "type") f.upload.sourceType = "WASTE_RECEIPT";
  if (mode === "etag") f.source.blobEtag = "other";
  if (mode === "blob") f.upload.blob = null;
  if (mode === "registeredAt") f.source.createdAt = new Date("invalid");
  await expect(
    f.service.download(f.storeId, f.actorId, f.sourceId),
  ).rejects.toMatchObject({ statusCode: expect.any(Number) });
  expect(f.sign).not.toHaveBeenCalled();
});
it.each(["missing", "path", "size", "mime", "etag", "withdrawn"])(
  "rechecks private Blob %s before signing",
  async (mode) => {
    const f = fixture();
    if (mode === "missing") f.head.mockResolvedValue(null as never);
    if (mode === "path") f.blob.pathname = "other";
    if (mode === "size") f.blob.size++;
    if (mode === "mime") f.blob.contentType = "image/png";
    if (mode === "etag") f.blob.etag = "replaced";
    if (mode === "withdrawn")
      f.head.mockImplementation(async () => {
        f.source.deletedAt = new Date();
        return { ...f.blob };
      });
    await expect(
      f.service.download(f.storeId, f.actorId, f.sourceId),
    ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    expect(f.sign).not.toHaveBeenCalled();
  },
);
it("does not return a capability after source withdrawal, an unsafe URL or authorization revocation during signing", async () => {
  for (const mode of [
    "withdrawn",
    "foreign",
    "url",
    "authorization",
  ] as const) {
    const f = fixture();
    f.sign.mockImplementation(async () => {
      if (mode === "withdrawn") f.source.deletedAt = new Date();
      if (mode === "foreign") f.upload.userId = randomUUID();
      return mode === "url" ? "https://attacker.invalid/file" : f.blob.url;
    });
    await expect(
      f.service.download(f.storeId, f.actorId, f.sourceId, async () => {
        if (mode === "authorization") throw Error("SESSION_REVOKED");
      }),
    ).rejects.toThrow();
  }
});
