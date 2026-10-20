import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  RECEIPT_PHOTO_BUNDLE_MIME,
  RECEIPT_PHOTO_BUNDLE_VERSION,
} from "@fl-copilot/domain";
import type { SourceOriginalManifest } from "@fl-copilot/sync-contracts";
const state = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  fetch: vi.fn(),
}));
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/")
        .replace(/([^:])\/{2,}/g, "$1/");
    }
    get exists() {
      return state.files.has(this.uri);
    }
    get size() {
      return state.files.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      return state.files.get(this.uri)!.slice();
    }
    create() {
      if (this.exists) throw Error("EXISTS");
      state.files.set(this.uri, new Uint8Array());
    }
    write(data: Uint8Array) {
      state.files.set(this.uri, data.slice());
    }
    delete() {
      state.files.delete(this.uri);
    }
    open() {
      return {
        writeBytes: (data: Uint8Array) => {
          const old = state.files.get(this.uri)!;
          const all = new Uint8Array(old.length + data.length);
          all.set(old);
          all.set(data, old.length);
          state.files.set(this.uri, all);
        },
        close: () => {},
      };
    }
    move(to: File) {
      state.files.set(to.uri, state.files.get(this.uri)!);
      state.files.delete(this.uri);
      this.uri = to.uri;
    }
  }
  class Directory extends File {
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: "file:///app" } } };
});
vi.mock("expo-crypto", () => ({
  randomUUID,
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digest: async (_: unknown, bytes: Uint8Array) => {
    const result = createHash("sha256").update(bytes).digest();
    return result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.length,
    );
  },
  digestStringAsync: async (_: unknown, text: string) =>
    createHash("sha256").update(text).digest("hex"),
}));
vi.mock("expo/fetch", () => ({ fetch: state.fetch }));
import { nativeSourceOriginalFiles as files } from "./source-original-files";
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const scope = {
  storeId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  sourceId: "33333333-3333-4333-8333-333333333333",
};
function lease(bytes: Uint8Array, mimeType: string = "application/pdf") {
  const manifest = {
    schemaVersion: 1,
    storeId: scope.storeId,
    access: "STORE",
    ownerId: null,
    sourceDocumentId: scope.sourceId,
    sourceType:
      mimeType === RECEIPT_PHOTO_BUNDLE_MIME
        ? "WASTE_RECEIPT"
        : "WEEKLY_COMMERCIAL_PDF",
    filename: "original.pdf",
    mimeType,
    sizeBytes: bytes.length,
    checksum: checksum(bytes),
    registeredAt: "2026-10-20T12:00:00Z",
    objectVersion: "v1",
    manifestHash: `sha256:${"b".repeat(64)}`,
  } as SourceOriginalManifest;
  return {
    manifest,
    url: "https://test.private.blob.vercel-storage.com/original?test-only=1",
    expiresAt: "2026-10-20T13:02:00Z",
  };
}
beforeEach(() => {
  state.files.clear();
  state.fetch.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z"));
});
afterEach(() => vi.useRealTimers());
it("streams the exact original, retains its final file after move/finally and reads it without network", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nunchanged original"),
    l = lease(bytes);
  state.fetch.mockResolvedValue(
    new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
      },
    }),
  );
  const check = vi.fn(),
    proof = await files.receive(l, scope.ownerId, check);
  expect(state.files.get(proof.localUri)).toEqual(bytes);
  expect([...state.files.keys()]).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/partial$/)]),
  );
  expect(proof.views).toBeNull();
  await expect(
    files.existing(l.manifest, proof.localUri, scope.ownerId),
  ).resolves.toEqual(proof);
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0]![1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
  });
});
it.each(["oversize", "short", "mime", "checksum", "expired", "scope"])(
  "rejects %s transfer and cleans only its disposable partial file",
  async (mode) => {
    const original = new TextEncoder().encode("%PDF-1.7\nsource"),
      l = lease(original);
    state.files.set("file:///app/precious-unsent-original", original.slice());
    const body =
      mode === "oversize"
        ? new Uint8Array(original.length + 1)
        : mode === "short"
          ? original.slice(1)
          : mode === "checksum"
            ? original.slice().fill(1)
            : original;
    if (mode === "expired") l.expiresAt = "2026-10-20T12:59:59Z";
    state.fetch.mockResolvedValue(
      new Response(body, {
        headers: {
          "content-type": mode === "mime" ? "text/plain" : "application/pdf",
        },
      }),
    );
    let checks = 0;
    await expect(
      files.receive(l, scope.ownerId, () => {
        if (mode === "scope" && ++checks > 1) throw Error("SCOPE_CHANGED");
      }),
    ).rejects.toThrow();
    expect(state.files.get("file:///app/precious-unsent-original")).toEqual(
      original,
    );
    expect([...state.files.keys()]).toEqual([
      "file:///app/precious-unsent-original",
    ]);
  },
);
it("restores and verifies the ordered original receipt views as well as their immutable bundle", async () => {
  const views = [
    new Uint8Array([255, 216, 255, 1]),
    new Uint8Array([255, 216, 255, 2]),
  ];
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
      mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
      views: views.map((data) => ({
        mimeType: "image/jpeg",
        sizeBytes: data.length,
        checksum: checksum(data),
        dataBase64: Buffer.from(data).toString("base64"),
      })),
    }),
  );
  const l = lease(bytes, RECEIPT_PHOTO_BUNDLE_MIME);
  state.fetch.mockResolvedValue(
    new Response(bytes, { headers: { "content-type": l.manifest.mimeType } }),
  );
  const proof = await files.receive(l, scope.ownerId, () => {});
  expect(state.files.get(proof.localUri)).toEqual(bytes);
  expect(proof.views?.map((v) => state.files.get(v.localUri))).toEqual(views);
  const oldContainer = proof.localUri.replace(
    "file:///app/",
    "file:///old-container/",
  );
  await expect(
    files.existing(l.manifest, oldContainer, scope.ownerId),
  ).resolves.toEqual(proof);
});
it("refuses bundle views with a forged hash without replacing an existing original", async () => {
  const data = new Uint8Array([255, 216, 255, 1]);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
      mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
      views: ["a", "b"].map((h) => ({
        mimeType: "image/jpeg",
        sizeBytes: data.length,
        checksum: `sha256:${h.repeat(64)}`,
        dataBase64: Buffer.from(data).toString("base64"),
      })),
    }),
  );
  const l = lease(bytes, RECEIPT_PHOTO_BUNDLE_MIME);
  state.fetch.mockResolvedValue(
    new Response(bytes, { headers: { "content-type": l.manifest.mimeType } }),
  );
  await expect(files.receive(l, scope.ownerId, () => {})).rejects.toThrow();
  expect(state.files.size).toBe(0);
});
