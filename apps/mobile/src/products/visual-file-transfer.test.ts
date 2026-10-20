import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { visualFileManifestSchema } from "@fl-copilot/sync-contracts";
import {
  visualLibraryFixture,
  testVisualId,
} from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { applyVisualEntity } from "./visual-library-repository";
import {
  VisualFileCache,
  visualFilePath,
  type VerifiedVisualFile,
} from "./visual-file-cache";
import {
  VisualFileTransfer,
  type VisualFileSession,
  type VisualFileTransport,
} from "./visual-file-transfer";
import type { VisualFileStorage } from "./visual-file-storage";
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function setup() {
  const f = visualLibraryFixture(),
    db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  const source = new Uint8Array([255, 216, 255, 217]),
    preview = new Uint8Array([255, 216, 255, 218]);
  f.asset = {
    ...f.asset,
    contentHash: hash(source),
    sizeBytes: source.byteLength,
  };
  f.asset.id = testVisualId("visual_asset", f.storeId, f.asset.contentHash);
  await applyVisualEntity(db, f.storeId, "visual_asset", f.asset);
  const cache = new VisualFileCache(db),
    manifest = visualFileManifestSchema.parse({
      assetId: f.asset.id,
      storeId: f.storeId,
      processorVersion: "visual-image.v1",
      source: {
        contentHash: f.asset.contentHash,
        sizeBytes: source.byteLength,
        mimeType: f.asset.mimeType,
        width: 500,
        height: 500,
      },
      preview: {
        contentHash: hash(preview),
        sizeBytes: preview.byteLength,
        mimeType: "image/jpeg",
        width: 100,
        height: 100,
      },
    });
  const local = new Map<string, Uint8Array>();
  const files: VisualFileStorage = {
    removeCached: vi.fn(),
    capture: vi.fn(),
    read: vi.fn(async (store, variant, d) => {
      const bytes = local.get(
        visualFilePath(store, variant, d.mimeType, d.contentHash),
      );
      if (!bytes) throw Error("VISUAL_SOURCE_FILE_MISSING");
      if (hash(bytes) !== d.contentHash || bytes.byteLength !== d.sizeBytes)
        throw Error("VISUAL_FILE_INVALID");
      return bytes;
    }),
    write: vi.fn(async (store, variant, d, bytes) => {
      if (hash(bytes) !== d.contentHash || bytes.byteLength !== d.sizeBytes)
        throw Error("VISUAL_FILE_INVALID");
      const relativePath = visualFilePath(
        store,
        variant,
        d.mimeType,
        d.contentHash,
      );
      local.set(relativePath, bytes.slice());
      return {
        relativePath,
        contentHash: d.contentHash,
        sizeBytes: d.sizeBytes,
      };
    }),
    uri: vi.fn(async (store, variant, d) =>
      local.has(visualFilePath(store, variant, d.mimeType, d.contentHash))
        ? `file:///app/${visualFilePath(store, variant, d.mimeType, d.contentHash)}`
        : null,
    ),
    upload: vi.fn(async () => {}),
  };
  let session: VisualFileSession | null = {
    storeId: f.storeId,
    userId: f.actorId,
    canWrite: true,
  };
  const api: VisualFileTransport = {
    init: vi.fn(async () => ({
      state: "UPLOAD_REQUIRED" as const,
      uploadId: f.deviceId,
      uploadUrl: "https://private.example.test/scoped",
      expiresAt: "2026-10-20T15:00:00.000Z",
      headers: { "content-type": "image/jpeg" },
      manifest: null,
    })),
    complete: vi.fn(async () => manifest),
    manifest: vi.fn(async () => manifest),
    download: vi.fn(async () => preview),
  };
  const transfer = new VisualFileTransfer(db, api, files, () => session);
  const proof: VerifiedVisualFile = {
    relativePath: visualFilePath(
      f.storeId,
      "SOURCE",
      f.asset.mimeType,
      f.asset.contentHash,
    ),
    contentHash: f.asset.contentHash,
    sizeBytes: source.byteLength,
  };
  local.set(proof.relativePath, source);
  await cache.remember(f.storeId, f.asset.id, "SOURCE", proof);
  return {
    db,
    f,
    source,
    preview,
    local,
    files,
    cache,
    manifest,
    api,
    transfer,
    setSession: (next: typeof session) => {
      session = next;
    },
  };
}
it("sends after metadata acknowledgement and coalesces repeated taps without forwarding the API token to storage", async () => {
  const s = await setup();
  try {
    const [a, b] = await Promise.all([
      s.transfer.send(s.f.asset.id),
      s.transfer.send(s.f.asset.id),
    ]);
    expect(a).toEqual(b);
    expect(s.api.init).toHaveBeenCalledTimes(1);
    expect(s.api.complete).toHaveBeenCalledTimes(1);
    expect(s.files.upload).toHaveBeenCalledWith(
      s.f.storeId,
      s.f.asset,
      "https://private.example.test/scoped",
      { "content-type": "image/jpeg" },
    );
    expect(await s.cache.get(s.f.storeId, s.f.asset, "SOURCE")).toMatchObject({
      uploaded: true,
      pinned: true,
    });
  } finally {
    s.db.raw.close();
  }
});
it("keeps an offline original pending until metadata is acknowledged and retains it if completion fails", async () => {
  const s = await setup();
  try {
    await s.db.runAsync(
      "UPDATE visual_assets SET dirty=1 WHERE id=?",
      s.f.asset.id,
    );
    await expect(s.transfer.send(s.f.asset.id)).rejects.toThrow(
      "VISUAL_METADATA_PENDING",
    );
    expect(s.api.init).not.toHaveBeenCalled();
    await s.db.runAsync(
      "UPDATE visual_assets SET dirty=0 WHERE id=?",
      s.f.asset.id,
    );
    vi.mocked(s.api.complete).mockRejectedValueOnce(Error("NETWORK_LOST"));
    await expect(s.transfer.send(s.f.asset.id)).rejects.toThrow("NETWORK_LOST");
    expect(await s.cache.get(s.f.storeId, s.f.asset, "SOURCE")).toMatchObject({
      uploaded: false,
    });
    expect(s.local.size).toBe(1);
    expect(await s.transfer.send(s.f.asset.id)).toEqual(s.manifest);
  } finally {
    s.db.raw.close();
  }
});
it("adopts the verified server result after a lost response and never reuploads a completed binary", async () => {
  const s = await setup();
  try {
    vi.mocked(s.api.init).mockResolvedValueOnce({
      state: "READY",
      uploadId: null,
      uploadUrl: null,
      expiresAt: null,
      headers: {},
      manifest: s.manifest,
    });
    await s.transfer.send(s.f.asset.id);
    expect(s.files.upload).not.toHaveBeenCalled();
    expect(s.api.complete).not.toHaveBeenCalled();
    expect(await s.cache.get(s.f.storeId, s.f.asset, "SOURCE")).toMatchObject({
      uploaded: true,
    });
  } finally {
    s.db.raw.close();
  }
});
it("persists a verified preview, reuses it and resolves cached content with no network", async () => {
  const s = await setup();
  try {
    await s.transfer.send(s.f.asset.id);
    await s.transfer.fetchPreview(s.f.asset.id);
    expect(await s.cache.get(s.f.storeId, s.f.asset, "SOURCE")).toMatchObject({
      uploaded: true,
      pinned: false,
    });
    expect(await s.transfer.localUri(s.f.asset)).toContain("/preview-");
    const calls = vi.mocked(s.api.manifest).mock.calls.length;
    await s.transfer.localUri(s.f.asset);
    expect(vi.mocked(s.api.manifest).mock.calls).toHaveLength(calls);
    await s.transfer.fetchPreview(s.f.asset.id);
    expect(s.api.download).toHaveBeenCalledTimes(1);
  } finally {
    s.db.raw.close();
  }
});
it("refuses a corrupted or partial download and a foreign proof without marking a cached preview", async () => {
  const s = await setup();
  try {
    vi.mocked(s.api.download).mockResolvedValueOnce(new Uint8Array([1, 2]));
    await expect(s.transfer.fetchPreview(s.f.asset.id)).rejects.toThrow(
      "VISUAL_FILE_INVALID",
    );
    expect(await s.cache.get(s.f.storeId, s.f.asset, "PREVIEW")).toBeNull();
    vi.mocked(s.api.manifest).mockResolvedValueOnce({
      ...s.manifest,
      source: { ...s.manifest.source, width: 501 },
    });
    await expect(s.transfer.fetchPreview(s.f.asset.id)).rejects.toThrow(
      "VISUAL_FILE_BINDING_INVALID",
    );
    expect(s.api.download).toHaveBeenCalledTimes(1);
  } finally {
    s.db.raw.close();
  }
});
it("stops after account/store changes or a known revocation instead of recording work under another account", async () => {
  const s = await setup();
  try {
    vi.mocked(s.api.init).mockImplementationOnce(async () => {
      s.setSession(null);
      return {
        state: "READY",
        uploadId: null,
        uploadUrl: null,
        expiresAt: null,
        headers: {},
        manifest: s.manifest,
      };
    });
    await expect(s.transfer.send(s.f.asset.id)).rejects.toThrow(
      "VISUAL_SCOPE_CHANGED",
    );
    expect(await s.cache.get(s.f.storeId, s.f.asset, "SOURCE")).toMatchObject({
      uploaded: false,
    });
    s.setSession({
      storeId: s.f.storeId,
      userId: s.f.actorId,
      canWrite: true,
    });
    const revoked = {
      ...s.f.asset,
      version: 2,
      review: { status: "REVOKED" as const, actorId: s.f.actorId, at: s.f.at },
    };
    await applyVisualEntity(s.db, s.f.storeId, "visual_asset", revoked);
    await expect(s.transfer.localUri(s.f.asset)).rejects.toThrow(
      "VISUAL_ASSET_UNAVAILABLE",
    );
    expect(s.api.download).not.toHaveBeenCalled();
  } finally {
    s.db.raw.close();
  }
});
