import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { illustrationAssetsFixture } from "../../../../scripts/test-layout-illustration-assets";
import { nativeLayoutIllustrationFiles as files } from "./layout-illustration-native-files";
const native = vi.hoisted(() => ({
  root: "",
  dimensions: { width: 1536, height: 1024 },
  beforeMove: undefined as (() => Promise<void>) | undefined,
  afterMove: undefined as (() => void) | undefined,
  failMove: false,
}));
vi.mock("react-native", () => ({
  Image: { getSize: async () => native.dimensions },
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"),
    url = await import("node:url"),
    path = await import("node:path");
  const p = (parts: (string | { uri: string })[]) =>
    path.join(
      ...parts.map((v) =>
        typeof v === "string"
          ? v.startsWith("file:")
            ? url.fileURLToPath(v)
            : v
          : url.fileURLToPath(v.uri),
      ),
    );
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(p(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    list() {
      return fs
        .readdirSync(url.fileURLToPath(this.uri), { withFileTypes: true })
        .map((e) =>
          e.isDirectory()
            ? new Directory(this, e.name)
            : new File(this, e.name),
        );
    }
    delete() {
      fs.rmdirSync(url.fileURLToPath(this.uri));
    }
    create() {
      fs.mkdirSync(url.fileURLToPath(this.uri), { recursive: true });
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(p(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(url.fileURLToPath(this.uri)).size;
    }
    create() {
      fs.writeFileSync(url.fileURLToPath(this.uri), new Uint8Array(), {
        flag: "wx",
      });
    }
    write(bytes: Uint8Array) {
      fs.writeFileSync(url.fileURLToPath(this.uri), bytes);
    }
    async move(to: File) {
      await Promise.resolve();
      await native.beforeMove?.();
      if (native.failMove) throw Error("NATIVE_MOVE_FAILED");
      fs.renameSync(url.fileURLToPath(this.uri), url.fileURLToPath(to.uri));
      this.uri = to.uri;
      native.afterMove?.();
    }
    delete() {
      fs.unlinkSync(url.fileURLToPath(this.uri));
    }
    async text() {
      return fs.readFileSync(url.fileURLToPath(this.uri), "utf8");
    }
    open() {
      const fd = fs.openSync(url.fileURLToPath(this.uri), "r");
      let offset = 0;
      return {
        readBytes(size: number) {
          const buffer = Buffer.alloc(size),
            n = fs.readSync(fd, buffer, 0, size, offset);
          offset += n;
          return new Uint8Array(buffer.subarray(0, n));
        },
        close() {
          fs.closeSync(fd);
        },
      };
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r" },
    Paths: {
      get document() {
        return url.pathToFileURL(native.root).href;
      },
    },
  };
});
beforeAll(async () => {
  native.root = await mkdtemp(join(tmpdir(), "fl-layout-native-files-"));
});
beforeEach(() => {
  native.beforeMove = undefined;
  native.afterMove = undefined;
  native.failMove = false;
  native.dimensions = { width: 1536, height: 1024 };
});
afterAll(async () => {
  await rm(native.root, { recursive: true, force: true });
});
it("installs verified pixels at an owner-specific immutable path, reuses them and preserves exact provider-original metadata", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const uri = await files.write(
      f.manifest,
      "original",
      f.bytes.original,
      () => {},
    );
    expect(uri).toContain(
      `/${f.scope.storeId}/${f.scope.ownerId}/${f.preparation.id}/${f.manifest.id}/`,
    );
    expect(await files.existing(f.manifest, "original")).toBe(uri);
    expect(new Uint8Array(await readFile(fileURLToPath(uri)))).toEqual(
      f.bytes.original,
    );
    expect(
      await files.write(f.manifest, "original", f.bytes.original, () => {}),
    ).toBe(uri);
  } finally {
    f.db.close();
  }
});

it("keeps the illustration write pending until relocation completes, while preserving a prior comparison", async () => {
  const f = await illustrationAssetsFixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  try {
    const prior = await files.write(
      f.manifest,
      "source",
      f.bytes.source,
      () => {},
    );
    native.beforeMove = async () => {
      entered();
      await gate;
    };
    let settled = false;
    const writing = files.write(f.manifest, "image", f.bytes.image, () => {});
    void writing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(settled).toBe(false);
      expect(new Uint8Array(await readFile(fileURLToPath(prior)))).toEqual(
        f.bytes.source,
      );
    } finally {
      release();
    }
    const uri = await writing;
    expect(new Uint8Array(await readFile(fileURLToPath(uri)))).toEqual(
      f.bytes.image,
    );
  } finally {
    release();
    f.db.close();
  }
});

it("rejects a late move failure without removing the previous comparison and resumes from the same bytes", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const prior = await files.write(
      f.manifest,
      "source",
      f.bytes.source,
      () => {},
    );
    native.failMove = true;
    await expect(
      files.write(f.manifest, "image", f.bytes.image, () => {}),
    ).rejects.toThrow("NATIVE_MOVE_FAILED");
    expect(
      await files.usage({ storeId: f.scope.storeId, userId: f.scope.ownerId }),
    ).toBe(f.bytes.source.length);
    expect(new Uint8Array(await readFile(fileURLToPath(prior)))).toEqual(
      f.bytes.source,
    );
    native.failMove = false;
    const uri = await files.write(f.manifest, "image", f.bytes.image, () => {});
    expect(new Uint8Array(await readFile(fileURLToPath(uri)))).toEqual(
      f.bytes.image,
    );
  } finally {
    f.db.close();
  }
});

it("does not return a newly installed illustration after owner authority changes during relocation", async () => {
  const f = await illustrationAssetsFixture();
  try {
    let allowed = true;
    native.afterMove = () => {
      allowed = false;
    };
    await expect(
      files.write(f.manifest, "image", f.bytes.image, () => {
        if (!allowed) throw Error("SCOPE_CHANGED");
      }),
    ).rejects.toThrow("SCOPE_CHANGED");
    const retained = await files.existing(f.manifest, "image");
    expect(retained).toBeTruthy();
    expect(new Uint8Array(await readFile(fileURLToPath(retained!)))).toEqual(
      f.bytes.image,
    );
  } finally {
    f.db.close();
  }
});

it("does not delete the complete original copy after lost native acknowledgement and reuses it on retry", async () => {
  const f = await illustrationAssetsFixture();
  try {
    native.afterMove = () => {
      throw Error("MOVE_ACK_LOST");
    };
    await expect(
      files.write(f.manifest, "original", f.bytes.original, () => {}),
    ).rejects.toThrow("MOVE_ACK_LOST");
    const retained = await files.existing(f.manifest, "original");
    expect(retained).toBeTruthy();
    expect(new Uint8Array(await readFile(fileURLToPath(retained!)))).toEqual(
      f.bytes.original,
    );
    native.afterMove = undefined;
    expect(
      await files.write(f.manifest, "original", f.bytes.original, () => {}),
    ).toBe(retained);
  } finally {
    f.db.close();
  }
});
it("rejects truncated bytes, wrong image dimensions and interrupted installation without leaving partial files", async () => {
  const f = await illustrationAssetsFixture();
  try {
    await expect(
      files.write(f.manifest, "image", new Uint8Array([0]), () => {}),
    ).rejects.toThrow("INVALID");
    native.dimensions = { width: 1, height: 1 };
    await expect(
      files.write(f.manifest, "image", f.bytes.image, () => {}),
    ).rejects.toThrow("INVALID");
    native.dimensions = { width: 1536, height: 1024 };
    let checks = 0;
    await expect(
      files.write(f.manifest, "image", f.bytes.image, () => {
        if (++checks > 1) throw Error("TEST_ACCOUNT_CHANGED");
      }),
    ).rejects.toThrow("TEST_ACCOUNT_CHANGED");
    expect(await files.existing(f.manifest, "image")).toBeNull();
    const paths = await readdir(native.root, { recursive: true });
    expect(paths.some((p) => p.endsWith(".partial"))).toBe(false);
  } finally {
    native.dimensions = { width: 1536, height: 1024 };
    f.db.close();
  }
});
it("repairs only a corrupt derived cache after verifying a complete replacement; unverified bytes cannot replace it", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const uri = await files.write(f.manifest, "image", f.bytes.image, () => {});
    await writeFile(fileURLToPath(uri), new Uint8Array([0]));
    await expect(files.existing(f.manifest, "image")).rejects.toThrow(
      "INVALID",
    );
    await expect(
      files.write(f.manifest, "image", new Uint8Array([1]), () => {}),
    ).rejects.toThrow("INVALID");
    expect(new Uint8Array(await readFile(fileURLToPath(uri)))).toEqual(
      new Uint8Array([0]),
    );
    expect(
      await files.write(f.manifest, "image", f.bytes.image, () => {}),
    ).toBe(uri);
    expect(await files.existing(f.manifest, "image")).toBe(uri);
  } finally {
    f.db.close();
  }
});
it("counts actual private copies and interrupted/unknown downloads, removing only the exact selected remote-copy path", async () => {
  const f = await illustrationAssetsFixture();
  try {
    const uri = await files.write(
        f.manifest,
        "source",
        f.bytes.source,
        () => {},
      ),
      scope = { storeId: f.scope.storeId, userId: f.scope.ownerId };
    expect(await files.usage(scope)).toBe(f.bytes.source.length);
    const unknown = join(fileURLToPath(uri), "..", "abandoned.partial");
    await writeFile(unknown, new Uint8Array([1, 2, 3]));
    expect(await files.usage(scope)).toBe(f.bytes.source.length + 3);
    expect(
      await files.usage({
        ...scope,
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBe(0);
    await expect(
      files.remove(f.manifest, "source", () => {
        throw Error("SCOPE_CHANGED");
      }),
    ).rejects.toThrow("SCOPE_CHANGED");
    expect(await files.existing(f.manifest, "source")).toBe(uri);
    await files.remove(f.manifest, "source", () => {});
    expect(await files.existing(f.manifest, "source")).toBeNull();
    expect(await files.usage(scope)).toBe(3);
    expect(new Uint8Array(await readFile(unknown))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  } finally {
    f.db.close();
  }
});
it("enforces the quota through the production transfer and real files, then restores its pinned comparison from SQLite after restart", async () => {
  const { randomUUID } = await import("node:crypto"),
    { DatabaseSync } = await import("node:sqlite"),
    { LayoutIllustrationTransfer } =
      await import("./layout-illustration-transfer"),
    { LayoutIllustrationRepository } =
      await import("./layout-illustration-repository"),
    { AllocationSqliteAdapter } =
      await import("../../../../scripts/test-physical-allocation-sqlite"),
    { illustrationDigest } =
      await import("../../../../scripts/test-layout-illustration-preparations"),
    { serializeLayoutIllustrationMetadata } =
      await import("@fl-copilot/sync-contracts"),
    { sourceOriginalHash } = await import("../documents/source-original-hash"),
    path = join(native.root, `${randomUUID()}.sqlite`),
    f = await illustrationAssetsFixture(path);
  let closed = false;
  try {
    const { manifestHash: hash, ...oldMetadata } = f.manifest;
    void hash;
    const metadata = {
        ...oldMetadata,
        id: randomUUID(),
        preparation: { ...f.preparation, id: randomUUID() },
      },
      old = {
        ...metadata,
        manifestHash: sourceOriginalHash(
          serializeLayoutIllustrationMetadata(metadata),
        ),
      },
      scope = { storeId: f.scope.storeId, userId: f.scope.ownerId },
      budgetBytes = f.bytes.source.length + f.bytes.image.length,
      originalDocument = join(
        native.root,
        `${randomUUID()}-unsynced-receipt.jpg`,
      );
    await writeFile(originalDocument, new Uint8Array([9, 8, 7]));
    await f.a.runAsync(
      "INSERT INTO copilot_layout_illustration_files(id,store_id,owner_id,preparation_id,created_at,manifest_json,last_accessed_at,offline_required) VALUES(?,?,?,?,?,?,?,1)",
      old.id,
      scope.storeId,
      scope.userId,
      old.preparation.id,
      old.createdAt,
      JSON.stringify(old),
      old.createdAt,
    );
    await files.write(old, "source", f.bytes.source, () => {});
    await files.write(old, "image", f.bytes.image, () => {});
    let downloads = 0;
    const api = {
        manifest: async () => ({ state: "READY", manifest: f.manifest }),
        download: async (_s: string, _m: unknown, v: keyof typeof f.bytes) => {
          downloads++;
          return f.bytes[v];
        },
      },
      transfer = new LayoutIllustrationTransfer(
        f.a,
        f.repo,
        api,
        files,
        () => scope,
        { budgetBytes },
      );
    await expect(transfer.refresh(f.card)).rejects.toThrow("CACHE_FULL");
    expect(downloads).toBe(0);
    expect(await files.usage(scope)).toBe(budgetBytes);
    await f.a.runAsync(
      "UPDATE copilot_layout_illustration_files SET offline_required=0 WHERE id=?",
      old.id,
    );
    const restored = await transfer.refresh(f.card);
    expect(restored?.sourceUri).toBeTruthy();
    expect(restored?.imageUri).toBeTruthy();
    expect(await files.existing(old, "source")).toBeNull();
    expect(await files.existing(old, "image")).toBeNull();
    expect(await files.usage(scope)).toBe(budgetBytes);
    expect(new Uint8Array(await readFile(originalDocument))).toEqual(
      new Uint8Array([9, 8, 7]),
    );
    const retained = await transfer.setOfflineRequired(
        f.card,
        f.manifest.id,
        true,
      ),
      before = await f.a.getAllAsync("SELECT * FROM sync_outbox");
    f.db.close();
    closed = true;
    const db = new DatabaseSync(path),
      a = new AllocationSqliteAdapter(db);
    try {
      const offline = new LayoutIllustrationTransfer(
        a,
        new LayoutIllustrationRepository(a, f.scope, illustrationDigest),
        {
          manifest: async () => {
            throw Error("OFFLINE");
          },
          download: async () => {
            throw Error("OFFLINE");
          },
        },
        files,
        () => scope,
        { budgetBytes },
      );
      expect(await offline.load(f.card)).toEqual(retained);
      expect(await a.getAllAsync("SELECT * FROM sync_outbox")).toEqual(before);
    } finally {
      db.close();
    }
  } finally {
    if (!closed) f.db.close();
  }
});
