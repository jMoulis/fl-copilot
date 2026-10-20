import { afterEach, it, expect, vi } from "vitest";
import { layoutIllustrationManifestSchema } from "@fl-copilot/sync-contracts";
import { ApiClient, ApiClientError } from "./index";
const id = "11111111-1111-4111-8111-111111111111",
  storeId = "22222222-2222-4222-8222-222222222222",
  hash = `sha256:${"a".repeat(64)}`,
  png = {
    checksum: hash,
    sizeBytes: 4,
    mimeType: "image/png",
    width: 1536,
    height: 1024,
  };
const manifest = layoutIllustrationManifestSchema.parse({
  id,
  preparation: {
    id,
    storeId,
    ownerId: id,
    conversationId: id,
    version: 1,
    intent: "PREPARATION_ONLY",
    renderer: "layout-topdown-v1",
    scenarioMessageId: id,
    assistantMessageId: id,
    scenarioHash: hash,
    physicalRevisionId: id,
    physicalVersion: 2,
    physicalHash: hash,
    createdAt: "2026-10-20T17:00:00.000Z",
  },
  createdAt: "2026-10-20T17:01:00.000Z",
  provenance: {
    provider: "OPENAI",
    textModel: "fixture",
    imageModel: "fixture",
    promptVersion: "layout-illustration-v1",
    responseId: null,
  },
  usage: { inputTokens: null, outputTokens: null },
  limitations: [],
  files: {
    source: png,
    original: png,
    image: png,
    data: { checksum: hash, sizeBytes: 4, mimeType: "application/json" },
  },
  manifestHash: hash,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("keeps manifest and binary reads on the authenticated API without exposing tokens in URLs", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/manifest")
        ? new Response(JSON.stringify({ state: "READY", manifest }))
        : new Response(new Uint8Array([1, 2, 3, 4]), {
            headers: { "content-type": "image/png", "content-length": "4" },
          });
    }),
  );
  const api = new ApiClient("https://api.test.invalid");
  expect(
    await api.layoutIllustrationManifest("private-token", storeId, id),
  ).toEqual({ state: "READY", manifest });
  expect(
    await api.downloadLayoutIllustrationFile(
      "private-token",
      storeId,
      manifest,
      "image",
    ),
  ).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(calls.map((c) => c.url)).toEqual([
    `https://api.test.invalid/api/v1/copilot/layout-illustrations/${id}/manifest`,
    `https://api.test.invalid/api/v1/copilot/layout-illustrations/${id}/results/${id}/image`,
  ]);
  for (const c of calls) {
    expect(c.url).not.toContain("private-token");
    expect(c.init.headers).toMatchObject({
      authorization: "Bearer private-token",
      "x-store-id": storeId,
    });
  }
  expect(calls[1]!.init.redirect).toBe("error");
});
it("rejects a foreign store before fetching and cancels an oversized streamed body", async () => {
  const cancel = vi.fn(),
    fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(5));
            },
            cancel,
          }),
          { headers: { "content-type": "image/png" } },
        ),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  await expect(
    api.downloadLayoutIllustrationFile("token", id, manifest, "image"),
  ).rejects.toThrow("SCOPE_INVALID");
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    api.downloadLayoutIllustrationFile("token", storeId, manifest, "image"),
  ).rejects.toMatchObject({
    response: { code: "LAYOUT_ILLUSTRATION_FILE_INVALID" },
  });
  expect(cancel).toHaveBeenCalled();
});
it.each(["manifest", "file"])(
  "releases a stalled %s read after its deadline so recovery can retry without a generation request",
  async (target) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(new Error("ABORTED")),
              { once: true },
            );
          }),
      ),
    );
    const api = new ApiClient("https://api.test.invalid"),
      request =
        target === "file"
          ? api.downloadLayoutIllustrationFile(
              "token",
              storeId,
              manifest,
              "image",
            )
          : api.layoutIllustrationManifest("token", storeId, id),
      failure = expect(request).rejects.toBeInstanceOf(ApiClientError);
    await vi.advanceTimersByTimeAsync(120000);
    await failure;
  },
);
