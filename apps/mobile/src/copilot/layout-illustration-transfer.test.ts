import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { illustrationAssetsFixture } from "../../../../scripts/test-layout-illustration-assets";
import {
  LayoutIllustrationTransfer,
  type LayoutIllustrationFilePort,
} from "./layout-illustration-transfer";
import { LayoutIllustrationRepository } from "./layout-illustration-repository";
import { AllocationSqliteAdapter } from "../../../../scripts/test-physical-allocation-sqlite";
import { illustrationDigest } from "../../../../scripts/test-layout-illustration-preparations";
import { sourceOriginalHash } from "../documents/source-original-hash";
function ports(f: Awaited<ReturnType<typeof illustrationAssetsFixture>>) {
  let session: { storeId: string; userId: string } | null = {
      storeId: f.scope.storeId,
      userId: f.scope.ownerId,
    },
    calls = 0,
    writes = 0,
    changed = false,
    corrupt = false;
  const files = new Map<string, Uint8Array>();
  const key = (id: string, v: string) => `${id}/${v}`;
  const storage: LayoutIllustrationFilePort = {
    existing: async (m, v) =>
      files.has(key(m.id, v)) ? `file:///synthetic/${key(m.id, v)}` : null,
    write: async (m, v, b, check) => {
      check();
      writes++;
      files.set(key(m.id, v), b);
      return `file:///synthetic/${key(m.id, v)}`;
    },
  };
  const api = {
    manifest: async () => {
      calls++;
      return {
        state: "READY",
        manifest: changed
          ? {
              ...f.manifest,
              preparation: {
                ...f.preparation,
                physicalHash: `sha256:${"a".repeat(64)}`,
              },
            }
          : f.manifest,
      };
    },
    download: async (_s: string, _m: unknown, v: keyof typeof f.bytes) => {
      if (corrupt) return new Uint8Array([0]);
      return f.bytes[v];
    },
  };
  const transfer = new LayoutIllustrationTransfer(
    f.a,
    f.repo,
    api,
    storage,
    () => session,
  );
  return {
    transfer,
    storage,
    api,
    files,
    calls: () => calls,
    writes: () => writes,
    session: (v: typeof session) => (session = v),
    changed: () => (changed = true),
    corrupt: () => (corrupt = true),
  };
}
it("loads locally first, coalesces a double tap and restores the same private image proof after file-backed SQLite restart without an Outbox command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fl-illustration-cache-")),
    path = join(dir, "local.sqlite"),
    f = await illustrationAssetsFixture(path),
    p = ports(f);
  let closed = false;
  try {
    expect(await p.transfer.load(f.card)).toBeNull();
    expect(p.calls()).toBe(0);
    const [one, two] = await Promise.all([
      p.transfer.refresh(f.card),
      p.transfer.refresh(f.card),
    ]);
    expect(one).toEqual(two);
    expect(p.calls()).toBe(1);
    expect(p.writes()).toBe(2);
    const count = await f.a.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) n FROM sync_outbox",
    );
    f.db.close();
    closed = true;
    const db = new DatabaseSync(path),
      a = new AllocationSqliteAdapter(db);
    try {
      const restored = new LayoutIllustrationTransfer(
        a,
        new LayoutIllustrationRepository(a, f.scope, illustrationDigest),
        p.api,
        p.storage,
        () => ({ storeId: f.scope.storeId, userId: f.scope.ownerId }),
      );
      expect(await restored.load(f.card)).toEqual(one);
      expect(p.calls()).toBe(1);
      expect(
        await a.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
      ).toEqual(count);
      const original = await restored.refresh(f.card, true);
      expect(original?.originalUri).toContain(f.manifest.id);
      expect(p.writes()).toBe(3);
      expect(
        sourceOriginalHash(p.files.get(`${f.manifest.id}/original`)!),
      ).toBe(f.manifest.files.original.checksum);
    } finally {
      db.close();
    }
  } finally {
    if (!closed) f.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects changed bindings and truncated bytes before installing a local proof", async () => {
  for (const kind of ["binding", "bytes"]) {
    const f = await illustrationAssetsFixture();
    try {
      const p = ports(f);
      if (kind === "binding") p.changed();
      else p.corrupt();
      await expect(p.transfer.refresh(f.card)).rejects.toThrow();
      expect(p.writes()).toBe(0);
      expect(
        await f.a.getAllAsync(
          "SELECT * FROM copilot_layout_illustration_files",
        ),
      ).toEqual([]);
    } finally {
      f.db.close();
    }
  }
});
it("cannot expose cached images to another account or a deleted private source", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const p = ports(f);
    await p.transfer.refresh(f.card);
    p.session({ storeId: f.scope.storeId, userId: randomUUID() });
    await expect(p.transfer.load(f.card)).rejects.toThrow("SCOPE_CHANGED");
    p.session({ storeId: f.scope.storeId, userId: f.scope.ownerId });
    await f.a.runAsync(
      "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
      JSON.stringify({ ...f.conversation, deletedMessageIds: [f.user.id] }),
      f.conversation.id,
    );
    await expect(p.transfer.load(f.card)).rejects.toThrow();
  } finally {
    f.db.close();
  }
});
it("keeps metadata and old local images when an account changes during a download", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const p = ports(f);
    p.api.download = async () => {
      p.session(null);
      return f.bytes.source;
    };
    await expect(p.transfer.refresh(f.card)).rejects.toThrow("SCOPE_CHANGED");
    expect(p.writes()).toBe(0);
    expect(
      await f.a.getAllAsync("SELECT * FROM copilot_layout_illustration_files"),
    ).toEqual([]);
  } finally {
    f.db.close();
  }
});
