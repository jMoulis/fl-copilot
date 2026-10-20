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
  uuid: vi.fn(),
  maximumRead: 0,
  wholeReads: 0,
  dimensions: vi.fn(),
}));
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      const segments = parts.map((p) => (typeof p === "string" ? p : p.uri));
      this.uri = [
        segments[0]!.replace(/\/+$/, ""),
        ...segments.slice(1).map((p) => p.replace(/^\/+|\/+$/g, "")),
      ].join("/");
    }
    get exists() {
      return state.files.has(this.uri);
    }
    get size() {
      return state.files.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      state.wholeReads++;
      return state.files.get(this.uri)!.slice();
    }
    async text() {
      return Buffer.from(state.files.get(this.uri)!).toString("utf8");
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
      let offset = 0;
      return {
        readBytes: (length: number) => {
          state.maximumRead = Math.max(state.maximumRead, length);
          const part = state.files
            .get(this.uri)!
            .slice(offset, offset + length);
          offset += part.length;
          return part;
        },
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
  return {
    File,
    Directory,
    FileMode: { ReadOnly: "r" },
    Paths: { document: { uri: "file:///app" } },
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: state.uuid }));
vi.mock("expo/fetch", () => ({ fetch: state.fetch }));
vi.mock("react-native", () => ({ Image: { getSize: state.dimensions } }));
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
  state.uuid.mockReset().mockImplementation(randomUUID);
  state.files.clear();
  state.maximumRead = 0;
  state.wholeReads = 0;
  state.fetch.mockReset();
  state.dimensions.mockReset().mockResolvedValue({ width: 6000, height: 6000 });
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
it("reads a retained captured original after container relocation without requiring its remote manifest", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nretained capture"),
    l = lease(bytes);
  state.files.set("file:///app/commercial-pdfs/original.pdf", bytes);
  await expect(
    files.existing(
      l.manifest,
      "file:///old-container/commercial-pdfs/original.pdf",
      scope.ownerId,
    ),
  ).resolves.toEqual({
    localUri: "file:///app/commercial-pdfs/original.pdf",
    views: null,
  });
  expect(state.fetch).not.toHaveBeenCalled();
});
it("verifies a large retained PDF in bounded chunks instead of reading the entire original into JS", async () => {
  vi.useRealTimers();
  const bytes = new Uint8Array(5 * 1024 * 1024 + 13).fill(32);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  const l = lease(bytes),
    uri = "file:///app/large-original.pdf";
  state.files.set(uri, bytes);
  await expect(files.existing(l.manifest, uri, scope.ownerId)).resolves.toEqual(
    { localUri: uri, views: null },
  );
  expect(state.wholeReads).toBe(0);
  expect(state.maximumRead).toBeLessThanOrEqual(1024 * 1024);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("does not delete a pre-existing partial file when a new temporary-file reservation fails", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nimmutable"),
    l = lease(bytes),
    id = "44444444-4444-4444-8444-444444444444";
  const prior = `file:///app/source-originals/${scope.storeId}/${scope.ownerId}/${scope.sourceId}/${id}.partial`;
  state.files.set(prior, new Uint8Array([1, 2, 3]));
  state.uuid.mockReturnValue(id);
  state.fetch.mockResolvedValue(
    new Response(bytes, { headers: { "content-type": "application/pdf" } }),
  );
  await expect(files.receive(l, scope.ownerId, () => {})).rejects.toThrow(
    "EXISTS",
  );
  expect(state.files.get(prior)).toEqual(new Uint8Array([1, 2, 3]));
});
it("aborts an active private stream on cancellation without retaining a partial original", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nimmutable"),
    l = lease(bytes),
    cancel = new AbortController();
  state.fetch.mockImplementation(
    async (_url: string, init: { signal: AbortSignal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 4));
            init.signal.addEventListener(
              "abort",
              () => controller.error(Error("ABORTED")),
              { once: true },
            );
          },
          pull() {
            cancel.abort();
          },
        }),
        { headers: { "content-type": "application/pdf" } },
      ),
  );
  await expect(
    files.receive(
      l,
      scope.ownerId,
      () => {
        if (cancel.signal.aborted) throw Error("CANCELLED");
      },
      cancel.signal,
    ),
  ).rejects.toThrow();
  expect(
    (state.fetch.mock.calls[0]![1] as { signal: AbortSignal }).signal.aborted,
  ).toBe(true);
  expect(state.files.size).toBe(0);
});
it.each(["pdf", "bundle"])(
  "rejects a wrongly typed %s original with a permanent integrity error",
  async (kind) => {
    const bytes = new TextEncoder().encode("not the declared file format"),
      l = lease(
        bytes,
        kind === "pdf" ? "application/pdf" : RECEIPT_PHOTO_BUNDLE_MIME,
      );
    state.fetch.mockResolvedValue(
      new Response(bytes, { headers: { "content-type": l.manifest.mimeType } }),
    );
    await expect(files.receive(l, scope.ownerId, () => {})).rejects.toThrow(
      "SOURCE_ORIGINAL_FILE_INVALID",
    );
    expect(state.files.size).toBe(0);
  },
);

it.each([
  "valid",
  "zero",
  "negative",
  "fractional",
  "nan",
  "pixels",
  "decoder",
  "foreign-owner",
  "mime",
  "tampered",
  "size",
])(
  "preserves private department photo guards for %s original",
  async (mode) => {
    const bytes = new Uint8Array([255, 216, 255, 16, 255, 217]);
    const l = lease(bytes, "image/jpeg");
    Object.assign(l.manifest, {
      sourceType: "STORE_PHOTO",
      access: "OWNER",
      ownerId: scope.ownerId,
      filename: "rayon.jpg",
    });
    const uri = "file:///app/store-photos/rayon.jpg";
    state.files.set(uri, bytes);
    if (mode === "zero")
      state.dimensions.mockResolvedValue({ width: 0, height: 1 });
    if (mode === "negative")
      state.dimensions.mockResolvedValue({ width: 1, height: -1 });
    if (mode === "fractional")
      state.dimensions.mockResolvedValue({ width: 1.5, height: 1 });
    if (mode === "nan")
      state.dimensions.mockResolvedValue({ width: NaN, height: 1 });
    if (mode === "pixels")
      state.dimensions.mockResolvedValue({ width: 6001, height: 6000 });
    if (mode === "decoder")
      state.dimensions.mockRejectedValue(Error("NATIVE_IMAGE_DECODE_FAILED"));
    if (mode === "mime") l.manifest.mimeType = "image/png";
    if (mode === "tampered") state.files.set(uri, bytes.slice().fill(0));
    if (mode === "size") l.manifest.sizeBytes++;
    const reading = files.existing(
      l.manifest,
      uri,
      mode === "foreign-owner" ? scope.storeId : scope.ownerId,
    );
    if (mode === "valid")
      await expect(reading).resolves.toEqual({ localUri: uri, views: null });
    else await expect(reading).rejects.toThrow("SOURCE_ORIGINAL_FILE_INVALID");
    expect(state.wholeReads).toBe(0);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.files.get(uri)).toBeDefined();
  },
);
