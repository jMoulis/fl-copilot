import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { visualFileManifestSchema } from "@fl-copilot/sync-contracts";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { VisualTestDatabase as DB } from "../../../../scripts/test-visual-sqlite";
import { applyVisualEntity } from "./visual-library-repository";
import { VisualFileCache, visualFilePath } from "./visual-file-cache";
async function setup(path = ":memory:") {
  const db = new DB(new DatabaseSync(path));
  await runLocalMigrations(db);
  const f = visualLibraryFixture();
  await applyVisualEntity(db, f.storeId, "visual_asset", f.asset);
  const manifest = visualFileManifestSchema.parse({
    assetId: f.asset.id,
    storeId: f.storeId,
    processorVersion: "visual-image.v1",
    source: {
      contentHash: f.asset.contentHash,
      sizeBytes: f.asset.sizeBytes,
      mimeType: f.asset.mimeType,
      width: f.asset.width,
      height: f.asset.height,
    },
    preview: {
      contentHash: `sha256:${"b".repeat(64)}`,
      sizeBytes: 100,
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
    },
  });
  let time = f.at;
  const cache = new VisualFileCache(db, () => time);
  const source = {
    contentHash: f.asset.contentHash,
    sizeBytes: f.asset.sizeBytes,
    relativePath: visualFilePath(
      f.storeId,
      "SOURCE",
      f.asset.mimeType,
      f.asset.contentHash,
    ),
  };
  const preview = {
    contentHash: manifest.preview.contentHash,
    sizeBytes: 100,
    relativePath: visualFilePath(
      f.storeId,
      "PREVIEW",
      "image/jpeg",
      manifest.preview.contentHash,
    ),
  };
  return {
    db,
    f,
    manifest,
    cache,
    source,
    preview,
    tick: (at: string) => {
      time = at;
    },
  };
}
it("persists verified relative paths across restart without marking a local original uploaded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-cache-"));
  let raw: DatabaseSync | undefined;
  try {
    const { db, f, source, cache } = await setup(join(dir, "device.db"));
    raw = db.raw;
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    await cache.setPinned(f.storeId, f.asset.id, "SOURCE", false);
    expect(await cache.evictable(f.storeId, 0)).toMatchObject({
      candidates: [],
      overBudget: true,
    });
    await cache.setOfflineRequired(f.storeId, f.asset.id, true, () => true);
    raw.close();
    raw = undefined;
    const restarted = new DB(new DatabaseSync(join(dir, "device.db")));
    raw = restarted.raw;
    expect(
      restarted.raw
        .prepare("SELECT offline_required FROM visual_assets WHERE id=?")
        .get(f.asset.id)!.offline_required,
    ).toBe(1);
    expect(
      await new VisualFileCache(restarted).get(f.storeId, f.asset, "SOURCE"),
    ).toMatchObject({ ...source, uploaded: false });
  } finally {
    raw?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("only releases a recoverable original after an authenticated manifest and verified preview exist", async () => {
  const { db, f, cache, source, preview, manifest } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    await cache.markUploaded(f.storeId, f.asset, manifest);
    expect((await cache.evictable(f.storeId, 100)).candidates).toEqual([]);
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    const lru = await cache.evictable(f.storeId, 100);
    expect(lru).toMatchObject({
      retainedBytes: 100,
      overBudget: false,
      candidates: [{ relativePath: source.relativePath }],
    });
    expect(
      await cache.evictRecoverable(
        f.storeId,
        lru.candidates[0]!,
        async () => {},
        () => true,
      ),
    ).toBe(true);
    expect(await cache.get(f.storeId, f.asset, "SOURCE")).toBeNull();
    expect(await cache.get(f.storeId, f.asset, "PREVIEW")).toMatchObject(
      preview,
    );
  } finally {
    db.raw.close();
  }
});
it("rejects foreign and altered manifest bindings, traversal and forged file proofs without erasing the source", async () => {
  const { db, f, cache, source, preview, manifest } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    for (const altered of [
      { ...manifest, storeId: randomUUID() },
      { ...manifest, assetId: randomUUID() },
      { ...manifest, source: { ...manifest.source, width: 501 } },
      { ...manifest, source: { ...manifest.source, height: 501 } },
      { ...manifest, source: { ...manifest.source, mimeType: "image/png" } },
      { ...manifest, source: { ...manifest.source, sizeBytes: 999 } },
      {
        ...manifest,
        source: { ...manifest.source, contentHash: `sha256:${"c".repeat(64)}` },
      },
    ]) {
      await expect(
        cache.remember(
          f.storeId,
          f.asset.id,
          "PREVIEW",
          preview,
          altered as typeof manifest,
        ),
      ).rejects.toThrow("VISUAL_FILE_BINDING_INVALID");
    }
    await expect(
      cache.remember(
        f.storeId,
        f.asset.id,
        "PREVIEW",
        { ...preview, relativePath: "../../private.jpg" },
        manifest,
      ),
    ).rejects.toThrow("VISUAL_FILE_INVALID");
    await expect(
      cache.remember(f.storeId, f.asset.id, "PREVIEW", preview),
    ).rejects.toThrow("VISUAL_FILE_MANIFEST_REQUIRED");
    expect(await cache.get(f.storeId, f.asset, "SOURCE")).toMatchObject(source);
    expect(() =>
      visualFilePath(
        "../../other",
        "SOURCE",
        "image/jpeg",
        f.asset.contentHash,
      ),
    ).toThrow();
  } finally {
    db.raw.close();
  }
});
it("rechecks pins, dirty writes and access time before evicting, and never crosses a store", async () => {
  const { db, f, cache, preview, manifest, tick } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    const candidate = (await cache.evictable(f.storeId, 0)).candidates[0]!;
    await cache.setPinned(f.storeId, f.asset.id, "PREVIEW", true);
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {},
        () => true,
      ),
    ).toBe(false);
    await cache.setPinned(f.storeId, f.asset.id, "PREVIEW", false);
    await db.runAsync(
      "UPDATE visual_assets SET dirty=1 WHERE id=?",
      f.asset.id,
    );
    expect((await cache.evictable(f.storeId, 0)).candidates).toEqual([]);
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {},
        () => true,
      ),
    ).toBe(false);
    await db.runAsync(
      "UPDATE visual_assets SET dirty=0 WHERE id=?",
      f.asset.id,
    );
    tick("2026-10-20T12:00:00.000Z");
    await cache.touch(f.storeId, f.asset.id, "PREVIEW");
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {},
        () => true,
      ),
    ).toBe(false);
    expect((await cache.evictable(randomUUID(), 0)).candidates).toEqual([]);
  } finally {
    db.raw.close();
  }
});
it("counts shared binaries once and uses the most recent reference for eviction", async () => {
  const { db, f, cache, preview, manifest, tick } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    const another = {
      ...f.asset,
      id: randomUUID(),
      contentHash: `sha256:${"d".repeat(64)}`,
    };
    await applyVisualEntity(db, f.storeId, "visual_asset", another);
    const samePreview = {
      ...manifest,
      assetId: another.id,
      source: { ...manifest.source, contentHash: another.contentHash },
    };
    tick("2026-10-20T12:00:00.000Z");
    await cache.remember(
      f.storeId,
      another.id,
      "PREVIEW",
      preview,
      samePreview,
    );
    expect(await cache.evictable(f.storeId, 100)).toMatchObject({
      candidates: [],
      retainedBytes: 100,
    });
    const candidate = (await cache.evictable(f.storeId, 0)).candidates[0]!;
    expect(candidate.lastAccessedAt).toBe("2026-10-20T12:00:00.000Z");
    await cache.setPinned(f.storeId, another.id, "PREVIEW", true);
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {},
        () => true,
      ),
    ).toBe(false);
    expect(await cache.get(f.storeId, f.asset, "PREVIEW")).not.toBeNull();
    await cache.setPinned(f.storeId, another.id, "PREVIEW", false);
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {},
        () => true,
      ),
    ).toBe(true);
    expect(await cache.get(f.storeId, another, "PREVIEW")).toBeNull();
  } finally {
    db.raw.close();
  }
});

it("physically evicts only a recoverable file, persists offline protection and counts actual retained bytes", async () => {
  const { db, f, cache, source, preview, manifest } = await setup();
  try {
    const removed: string[] = [];
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    await cache.markUploaded(f.storeId, f.asset, manifest);
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    await cache.setOfflineRequired(f.storeId, f.asset.id, true, () => true);
    expect(
      await cache.clean(
        f.storeId,
        async (file) => {
          removed.push(file.relativePath);
        },
        () => true,
        0,
      ),
    ).toMatchObject({ removed: 0, overBudget: true, retainedBytes: 1100 });
    expect(
      db.raw
        .prepare("SELECT offline_required FROM visual_assets WHERE id=?")
        .get(f.asset.id)!.offline_required,
    ).toBe(1);
    await cache.setOfflineRequired(f.storeId, f.asset.id, false, () => true);
    expect(
      await cache.clean(
        f.storeId,
        async (file) => {
          removed.push(file.relativePath);
        },
        () => true,
        100,
      ),
    ).toMatchObject({ removed: 1, overBudget: false, retainedBytes: 100 });
    expect(removed).toEqual([source.relativePath]);
    expect(await cache.get(f.storeId, f.asset, "PREVIEW")).not.toBeNull();
  } finally {
    db.raw.close();
  }
});
it("keeps sources if their remote proof is absent or revoked, and rolls back registry cleanup on deletion failure", async () => {
  const { db, f, cache, source, preview, manifest } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    await cache.markUploaded(f.storeId, f.asset, manifest);
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    await db.runAsync(
      "UPDATE visual_assets SET remote_payload_json=? WHERE id=?",
      JSON.stringify({
        ...f.asset,
        review: { status: "REVOKED", actorId: f.actorId, at: f.at },
      }),
      f.asset.id,
    );
    let called = 0;
    expect(
      await cache.clean(
        f.storeId,
        async () => {
          called++;
        },
        () => true,
        0,
      ),
    ).toMatchObject({ removed: 0, retainedBytes: 1100, overBudget: true });
    expect(called).toBe(0);
    await db.runAsync(
      "UPDATE visual_assets SET remote_payload_json=? WHERE id=?",
      JSON.stringify(f.asset),
      f.asset.id,
    );
    expect(
      await cache.clean(
        f.storeId,
        async () => {
          throw Error("DISK_OFFLINE");
        },
        () => true,
        0,
      ),
    ).toMatchObject({ removed: 0, failed: 2, retainedBytes: 1100 });
    expect(await cache.get(f.storeId, f.asset, "SOURCE")).not.toBeNull();
  } finally {
    db.raw.close();
  }
});

it("serializes an installation/pin ahead of stale eviction, and releases the file gate after a failure", async () => {
  const { withVisualFiles } = await import("./visual-file-lock");
  const { db, f, cache, preview, manifest } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "PREVIEW", preview, manifest);
    const candidate = (await cache.evictable(f.storeId, 0)).candidates[0]!;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const pin = withVisualFiles(f.storeId, async () => {
      await held;
      await db.runAsync(
        "UPDATE visual_assets SET offline_required=1 WHERE id=?",
        f.asset.id,
      );
    });
    let deleted = 0;
    const cleanup = cache.evictRecoverable(
      f.storeId,
      candidate,
      async () => {
        deleted++;
      },
      () => true,
    );
    release();
    await pin;
    expect(await cleanup).toBe(false);
    expect(deleted).toBe(0);
    await expect(
      withVisualFiles(f.storeId, async () => {
        throw Error("EXPECTED_FAILURE");
      }),
    ).rejects.toThrow("EXPECTED_FAILURE");
    await cache.setOfflineRequired(f.storeId, f.asset.id, false, () => true);
    expect(
      await cache.evictRecoverable(
        f.storeId,
        candidate,
        async () => {
          deleted++;
        },
        () => true,
      ),
    ).toBe(true);
    expect(deleted).toBe(1);
  } finally {
    db.raw.close();
  }
});
it("does not apply a cache preference after the owning session changes", async () => {
  const { db, f, cache } = await setup();
  try {
    await expect(
      cache.setOfflineRequired(f.storeId, f.asset.id, true, () => false),
    ).rejects.toThrow("VISUAL_SCOPE_CHANGED");
    expect(
      db.raw
        .prepare("SELECT offline_required FROM visual_assets WHERE id=?")
        .get(f.asset.id)!.offline_required,
    ).toBe(0);
  } finally {
    db.raw.close();
  }
});

it("retains the local offline preference across a remote metadata revision and exposes it to the view", async () => {
  const { loadVisualLibraryState } = await import("./visual-library-state");
  const { db, f, cache } = await setup();
  try {
    await cache.setOfflineRequired(f.storeId, f.asset.id, true, () => true);
    await applyVisualEntity(db, f.storeId, "visual_asset", {
      ...f.asset,
      version: 2,
      updatedAt: "2026-10-20T12:00:00.000Z",
    });
    expect(
      (
        await loadVisualLibraryState(db, f.storeId, f.actorId)
      ).offlineRequired?.has(f.asset.id),
    ).toBe(true);
  } finally {
    db.raw.close();
  }
});
it("brings a representative thumbnail cache below its budget without touching a pending original", async () => {
  const { db, f, cache, source } = await setup();
  try {
    await cache.remember(f.storeId, f.asset.id, "SOURCE", source);
    const bytes = 2 * 1024 * 1024;
    for (let i = 0; i < 40; i++) {
      const a = {
        ...f.asset,
        id: randomUUID(),
        contentHash: `sha256:${(1000 + i).toString(16).padStart(64, "0")}`,
      };
      await applyVisualEntity(db, f.storeId, "visual_asset", a);
      const manifest = visualFileManifestSchema.parse({
        assetId: a.id,
        storeId: f.storeId,
        processorVersion: "visual-image.v1",
        source: {
          contentHash: a.contentHash,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          width: a.width,
          height: a.height,
        },
        preview: {
          contentHash: `sha256:${(2000 + i).toString(16).padStart(64, "0")}`,
          mimeType: "image/jpeg",
          sizeBytes: bytes,
          width: 1024,
          height: 1024,
        },
      });
      await cache.remember(
        f.storeId,
        a.id,
        "PREVIEW",
        {
          relativePath: visualFilePath(
            f.storeId,
            "PREVIEW",
            "image/jpeg",
            manifest.preview.contentHash,
          ),
          contentHash: manifest.preview.contentHash,
          sizeBytes: bytes,
        },
        manifest,
      );
    }
    const deleted: string[] = [];
    const result = await cache.clean(
      f.storeId,
      async (file) => {
        deleted.push(file.relativePath);
      },
      () => true,
    );
    expect(result).toMatchObject({
      removed: 9,
      failed: 0,
      overBudget: false,
      retainedBytes: 31 * bytes + source.sizeBytes,
    });
    expect(deleted.every((p) => p.includes("/preview-"))).toBe(true);
    expect(await cache.get(f.storeId, f.asset, "SOURCE")).toMatchObject({
      uploaded: false,
    });
  } finally {
    db.raw.close();
  }
});
