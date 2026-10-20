import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { illustrationAssetsFixture } from "../../../../scripts/test-layout-illustration-assets";
import { nativeLayoutIllustrationFiles as files } from "./layout-illustration-native-files";
const native = vi.hoisted(() => ({
  root: "",
  dimensions: { width: 1536, height: 1024 },
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
    move(to: File) {
      fs.renameSync(url.fileURLToPath(this.uri), url.fileURLToPath(to.uri));
      this.uri = to.uri;
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
