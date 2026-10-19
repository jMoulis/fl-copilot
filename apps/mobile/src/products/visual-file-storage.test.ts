import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { nativeVisualFileStorage as storage } from "./visual-file-storage";
const state = vi.hoisted(() => ({
  bytes: new Map<string, Uint8Array>(),
  uploadCalls: [] as unknown[][],
  uploadStatus: 200,
  failWrite: false,
  failMove: false,
  seq: 0,
  createdDirectories: [] as string[],
}));
vi.mock("expo-crypto", async () => {
  const crypto = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digest: async (_algorithm: string, bytes: Uint8Array) =>
      new Uint8Array(crypto.createHash("sha256").update(bytes).digest()).buffer,
    randomUUID: () => `fixture-${++state.seq}`,
  };
});
vi.mock("react-native", () => ({
  Image: { getSize: async () => ({ width: 32, height: 16 }) },
}));
vi.mock("expo-file-system", () => {
  const path = (parts: (string | { uri: string })[]) =>
    parts.map((v) => (typeof v === "string" ? v : v.uri)).join("/");
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts);
    }
    create() {
      state.createdDirectories.push(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts);
    }
    get exists() {
      return state.bytes.has(this.uri);
    }
    get size() {
      return state.bytes.get(this.uri)?.byteLength ?? 0;
    }
    create() {
      if (this.exists) throw Error("TEST_EXISTS");
      state.bytes.set(this.uri, new Uint8Array());
    }
    write(bytes: Uint8Array) {
      if (state.failWrite) throw Error("TEST_DISK_FULL");
      state.bytes.set(this.uri, bytes.slice());
    }
    async bytes() {
      const bytes = state.bytes.get(this.uri);
      if (!bytes) throw Error("TEST_MISSING");
      return bytes.slice();
    }
    async move(to: File) {
      await Promise.resolve();
      if (state.failMove) throw Error("TEST_MOVE_FAILED");
      if (to.exists) throw Error("TEST_EXISTS");
      state.bytes.set(to.uri, await this.bytes());
      state.bytes.delete(this.uri);
      this.uri = to.uri;
    }
    delete() {
      state.bytes.delete(this.uri);
    }
    async upload(url: string, options: unknown) {
      state.uploadCalls.push([this.uri, url, options]);
      return { status: state.uploadStatus };
    }
  }
  return { File, Directory, Paths: { document: "file:///owned" } };
});
const storeId = "11111111-1111-4111-8111-111111111111",
  source = new Uint8Array([255, 216, 255, 217]);
const descriptor = {
  mimeType: "image/jpeg" as const,
  sizeBytes: source.length,
  contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
};
beforeEach(() => {
  state.bytes.clear();
  state.uploadCalls = [];
  state.failWrite = false;
  state.failMove = false;
  state.uploadStatus = 200;
  state.seq = 0;
  state.createdDirectories = [];
});
it("copies a selected original into immutable app storage and keeps it after the async move updates the File URI", async () => {
  state.bytes.set("file:///selected/photo.heic", source.slice());
  const captured = await storage.capture(
    storeId,
    "file:///selected/photo.heic",
  );
  expect(captured).toMatchObject({ ...descriptor, width: 32, height: 16 });
  expect(captured.relativePath).toMatch(
    /^visual-library\/[^/]+\/source-[a-f0-9]{64}\.jpg$/,
  );
  expect(state.bytes.get(`file:///owned/${captured.relativePath}`)).toEqual(
    source,
  );
  expect(state.bytes.has("file:///selected/photo.heic")).toBe(true);
  expect([...state.bytes.keys()].some((key) => key.endsWith(".part"))).toBe(
    false,
  );
  expect(await storage.uri(storeId, "SOURCE", descriptor)).toBe(
    `file:///owned/${captured.relativePath}`,
  );
});
it("verifies the actual bytes, reuses identical content and never erases a preexisting corrupt original", async () => {
  await expect(
    storage.write(storeId, "SOURCE", descriptor, new Uint8Array([1, 2])),
  ).rejects.toThrow("VISUAL_FILE_INVALID");
  expect(state.bytes.size).toBe(0);
  const proof = await storage.write(storeId, "SOURCE", descriptor, source),
    uri = `file:///owned/${proof.relativePath}`;
  await storage.write(storeId, "SOURCE", descriptor, source);
  expect(state.bytes.size).toBe(1);
  const corrupt = new Uint8Array([255, 216, 255, 216]);
  state.bytes.set(uri, corrupt);
  await expect(
    storage.write(storeId, "SOURCE", descriptor, source),
  ).rejects.toThrow("VISUAL_FILE_INVALID");
  expect(state.bytes.get(uri)).toEqual(corrupt);
  await expect(storage.uri(storeId, "SOURCE", descriptor)).rejects.toThrow(
    "VISUAL_FILE_INVALID",
  );
});
it.each(["write", "move"])(
  "cleans only its temporary file after a %s failure, preserving the selected source",
  async (kind) => {
    state.bytes.set("file:///selected/original", source.slice());
    state.failWrite = kind === "write";
    state.failMove = kind === "move";
    await expect(
      storage.capture(storeId, "file:///selected/original"),
    ).rejects.toThrow(kind === "write" ? "TEST_DISK_FULL" : "TEST_MOVE_FAILED");
    expect([...state.bytes.keys()]).toEqual(["file:///selected/original"]);
  },
);
it("uploads only verified app-owned bytes and the scoped headers, retaining them after network failure", async () => {
  const file = await storage.write(storeId, "SOURCE", descriptor, source);
  const headers = { "content-type": "image/jpeg" };
  state.uploadStatus = 503;
  await expect(
    storage.upload(
      storeId,
      descriptor,
      "https://private.example.test/signed",
      headers,
    ),
  ).rejects.toThrow("VISUAL_UPLOAD_HTTP_503");
  expect(state.uploadCalls).toEqual([
    [
      `file:///owned/${file.relativePath}`,
      "https://private.example.test/signed",
      { httpMethod: "PUT", headers },
    ],
  ]);
  expect(state.bytes.get(`file:///owned/${file.relativePath}`)).toEqual(source);
  await expect(
    storage.upload(
      storeId,
      descriptor,
      "http://private.example.test/signed",
      headers,
    ),
  ).rejects.toThrow("VISUAL_UPLOAD_URL_INVALID");
  const directories = state.createdDirectories.length;
  await expect(
    storage.write("../../other", "SOURCE", descriptor, source),
  ).rejects.toThrow();
  expect(state.createdDirectories).toHaveLength(directories);
});

it("repairs only a recoverable preview after staging verified bytes, preserving every source file", async () => {
  const original = await storage.write(storeId, "SOURCE", descriptor, source);
  const preview = await storage.write(storeId, "PREVIEW", descriptor, source);
  const previewUri = `file:///owned/${preview.relativePath}`;
  state.bytes.set(previewUri, new Uint8Array([255, 216, 255, 216]));
  state.failWrite = true;
  await expect(
    storage.write(storeId, "PREVIEW", descriptor, source),
  ).rejects.toThrow("TEST_DISK_FULL");
  expect(state.bytes.get(previewUri)).toEqual(
    new Uint8Array([255, 216, 255, 216]),
  );
  state.failWrite = false;
  await storage.write(storeId, "PREVIEW", descriptor, source);
  expect(state.bytes.get(previewUri)).toEqual(source);
  expect(state.bytes.get(`file:///owned/${original.relativePath}`)).toEqual(
    source,
  );
});

it("constrains cleanup to the store-owned cache and refuses deleting a source whose bytes no longer match its proof", async () => {
  const file = await storage.write(storeId, "SOURCE", descriptor, source);
  await expect(
    storage.removeCached(storeId, {
      ...file,
      relativePath: "../../private.jpg",
    }),
  ).rejects.toThrow("VISUAL_FILE_LOCATION_INVALID");
  const uri = `file:///owned/${file.relativePath}`;
  state.bytes.set(uri, new Uint8Array([255, 216, 255, 216]));
  await expect(storage.removeCached(storeId, file)).rejects.toThrow(
    "VISUAL_FILE_INVALID",
  );
  expect(state.bytes.has(uri)).toBe(true);
  state.bytes.set(uri, source.slice());
  await storage.removeCached(storeId, file);
  expect(state.bytes.has(uri)).toBe(false);
});
