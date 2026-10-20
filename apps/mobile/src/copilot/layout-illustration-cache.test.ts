import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { LayoutIllustrationManifest } from "@fl-copilot/sync-contracts";
import { serializeLayoutIllustrationMetadata } from "@fl-copilot/sync-contracts";
import { illustrationAssetsFixture } from "../../../../scripts/test-layout-illustration-assets";
import { sourceOriginalHash } from "../documents/source-original-hash";
import {
  reserveIllustrationCache,
  withIllustrationCache,
  type LayoutIllustrationCacheFiles,
} from "./layout-illustration-cache";
function another(
  m: LayoutIllustrationManifest,
  patch: Partial<LayoutIllustrationManifest["preparation"]> = {},
) {
  const { manifestHash: _hash, ...data } = m;
  void _hash;
  const metadata = {
    ...data,
    id: randomUUID(),
    preparation: { ...data.preparation, id: randomUUID(), ...patch },
  };
  return {
    ...metadata,
    manifestHash: sourceOriginalHash(
      serializeLayoutIllustrationMetadata(metadata),
    ),
  };
}
function physical() {
  const bytes = new Map<string, number>(),
    removed: string[] = [];
  const key = (m: LayoutIllustrationManifest, v: string) =>
    `${m.preparation.storeId}/${m.preparation.ownerId}/${m.id}/${v}`;
  const port: LayoutIllustrationCacheFiles = {
    usage: async (s) =>
      [...bytes]
        .filter(([k]) => k.startsWith(`${s.storeId}/${s.userId}/`))
        .reduce((n, [, size]) => n + size, 0),
    remove: async (m, v, check) => {
      check();
      removed.push(key(m, v));
      bytes.delete(key(m, v));
    },
  };
  return {
    port,
    bytes,
    removed,
    put: (m: LayoutIllustrationManifest, v: string, n: number) =>
      bytes.set(key(m, v), n),
  };
}
async function remember(
  f: Awaited<ReturnType<typeof illustrationAssetsFixture>>,
  m: LayoutIllustrationManifest,
  last: string,
  pin = 0,
) {
  await f.a.runAsync(
    "INSERT INTO copilot_layout_illustration_files(id,store_id,owner_id,preparation_id,created_at,manifest_json,last_accessed_at,offline_required) VALUES(?,?,?,?,?,?,?,?)",
    m.id,
    m.preparation.storeId,
    m.preparation.ownerId,
    m.preparation.id,
    m.createdAt,
    JSON.stringify(m),
    last,
    pin,
  );
}
it("reclaims actual downloaded bytes least-recently-used, retaining private provenance and every pinned/current-source copy", async () => {
  const f = await illustrationAssetsFixture(),
    p = physical();
  try {
    const oldest = another(f.manifest),
      recent = another(f.manifest),
      pinned = another(f.manifest),
      currentHistorical = another(f.manifest, { id: f.preparation.id });
    await remember(f, recent, "2026-10-20T12:00:00Z");
    await remember(f, oldest, "2026-10-19T12:00:00Z");
    await remember(f, pinned, "2026-10-18T12:00:00Z", 1);
    await remember(f, currentHistorical, "2026-10-17T12:00:00Z");
    for (const m of [oldest, recent, pinned, currentHistorical])
      p.put(m, "original", 10);
    await reserveIllustrationCache(f.a, p.port, f.manifest, 20, () => {}, 50);
    expect(p.removed).toEqual([
      `${f.scope.storeId}/${f.scope.ownerId}/${oldest.id}/original`,
    ]);
    expect(
      await p.port.usage({ storeId: f.scope.storeId, userId: f.scope.ownerId }),
    ).toBe(30);
    expect(
      (
        await f.a.getAllAsync(
          "SELECT id FROM copilot_layout_illustration_files",
        )
      ).length,
    ).toBe(4);
  } finally {
    f.db.close();
  }
});
it("counts unindexed bytes without deleting them, rejects impossible/pinned capacity, and never deletes another account/store", async () => {
  const f = await illustrationAssetsFixture(),
    p = physical();
  try {
    const owner = another(f.manifest, { ownerId: randomUUID() }),
      store = another(f.manifest, { storeId: randomUUID() }),
      pinned = another(f.manifest);
    for (const m of [owner, store, pinned]) {
      await remember(f, m, "2026-10-18T12:00:00Z", m.id === pinned.id ? 1 : 0);
      p.put(m, "original", 20);
    }
    p.bytes.set(`${f.scope.storeId}/${f.scope.ownerId}/unknown/file`, 30);
    await expect(
      reserveIllustrationCache(f.a, p.port, f.manifest, 1, () => {}, 50),
    ).rejects.toThrow("CACHE_FULL");
    await expect(
      reserveIllustrationCache(f.a, p.port, f.manifest, 51, () => {}, 50),
    ).rejects.toThrow("CACHE_FULL");
    expect(p.removed).toEqual([]);
    expect(p.bytes.size).toBe(4);
  } finally {
    f.db.close();
  }
});
it("refuses tampered/cross-bound cleanup metadata, preserves an interrupted transfer's registered copies and stops on scope loss", async () => {
  const f = await illustrationAssetsFixture(),
    p = physical();
  try {
    const bad = another(f.manifest);
    await remember(
      f,
      { ...bad, manifestHash: `sha256:${"0".repeat(64)}` },
      "2026-10-17T12:00:00Z",
    );
    p.put(bad, "original", 30);
    await expect(
      reserveIllustrationCache(f.a, p.port, f.manifest, 1, () => {}, 30),
    ).rejects.toThrow("CACHE_FULL");
    expect(p.removed).toEqual([]);
    const partial = another(f.manifest);
    await remember(f, partial, "2026-10-18T12:00:00Z");
    p.put(partial, "source", 10);
    await reserveIllustrationCache(f.a, p.port, f.manifest, 1, () => {}, 35);
    expect(
      p.bytes.has(`${f.scope.storeId}/${f.scope.ownerId}/${partial.id}/source`),
    ).toBe(false);
    const before = [...p.bytes];
    await expect(
      reserveIllustrationCache(
        f.a,
        p.port,
        f.manifest,
        1,
        () => {
          throw Error("SCOPE_CHANGED");
        },
        0,
      ),
    ).rejects.toThrow();
    expect([...p.bytes]).toEqual(before);
  } finally {
    f.db.close();
  }
});
it("serializes capacity/touch/pin across controller instances and releases the gate after a rejected task", async () => {
  const scope = { storeId: randomUUID(), userId: randomUUID() },
    order: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = withIllustrationCache(scope, async () => {
    order.push("download");
    await blocked;
    order.push("installed");
    throw Error("FAILED");
  });
  const b = withIllustrationCache(scope, async () => {
    order.push("pin");
  });
  await Promise.resolve();
  expect(order).toEqual(["download"]);
  release();
  await expect(a).rejects.toThrow("FAILED");
  await b;
  expect(order).toEqual(["download", "installed", "pin"]);
});
