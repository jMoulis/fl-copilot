import { afterEach, it, expect, vi } from "vitest";
import { visualFileManifestSchema } from "@fl-copilot/sync-contracts";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
const f = {
    storeId: "11111111-1111-4111-8111-111111111111",
    actorId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
    asset: {
      id: "44444444-4444-4444-8444-444444444444",
      contentHash: "sha256:" + "a".repeat(64),
      mimeType: "image/jpeg",
      sizeBytes: 4,
      width: 1,
      height: 1,
    },
  },
  bytes = new Uint8Array([1, 2, 3, 4]);
const manifest = visualFileManifestSchema.parse({
  assetId: f.asset.id,
  storeId: f.storeId,
  processorVersion: "visual-image.v1",
  source: {
    contentHash: f.asset.contentHash,
    mimeType: f.asset.mimeType,
    sizeBytes: f.asset.sizeBytes,
    width: f.asset.width,
    height: f.asset.height,
  },
  preview: {
    contentHash:
      "sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    mimeType: "image/jpeg",
    sizeBytes: 4,
    width: 1,
    height: 1,
  },
});
it.each([false, true])(
  "negotiates the visual library without implicitly enabling other capabilities (%s)",
  async (enabled) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            code: "UNAVAILABLE",
            messageFr: "Indisponible",
            retryable: true,
          }),
          { status: 503 },
        );
      }),
    );
    const client = new ApiClient("https://api.test.invalid"),
      pull: Parameters<ApiClient["pullSync"]> = ["token", f.storeId],
      boot: Parameters<ApiClient["bootstrapSync"]> = ["token", f.storeId];
    pull[29] = enabled;
    boot[28] = enabled;
    await expect(client.pullSync(...pull)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    await expect(client.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const url of urls) {
      const q = new URL(url).searchParams;
      expect(q.get("visualLibrary")).toBe(enabled ? "true" : null);
      for (const key of [
        "storeLayouts",
        "physicalAllocations",
        "copilotHistory",
      ])
        expect(q.get(key)).toBeNull();
    }
  },
);
it("keeps file initialization and completion scoped to the authenticated API and parses the private manifest", async () => {
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST" && JSON.parse(String(init.body)).uploadId
            ? manifest
            : {
                state: "READY",
                uploadId: null,
                uploadUrl: null,
                expiresAt: null,
                headers: {},
                manifest,
              },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient("https://api.test.invalid");
  expect(
    (await client.initVisualFile("token", f.storeId, f.asset.id)).manifest,
  ).toEqual(manifest);
  expect(
    await client.completeVisualFile("token", f.storeId, f.asset.id, f.deviceId),
  ).toEqual(manifest);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "https://api.test.invalid/api/v1/visual-files/init",
    "https://api.test.invalid/api/v1/visual-files/complete",
  ]);
  for (const [, init] of fetch.mock.calls)
    expect(init?.headers).toMatchObject({
      authorization: "Bearer token",
      "x-store-id": f.storeId,
    });
});
it("transfers opaque bytes within the exact manifest bounds without exposing a storage URL", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(bytes, {
        headers: { "content-type": "image/jpeg", "content-length": "4" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient("https://api.test.invalid");
  expect(
    await client.downloadVisualFile("token", f.storeId, manifest, "preview"),
  ).toEqual(bytes);
  expect(fetch).toHaveBeenCalledWith(
    `https://api.test.invalid/api/v1/visual-assets/${f.asset.id}/preview`,
    {
      headers: { authorization: "Bearer token", "x-store-id": f.storeId },
      redirect: "error",
      signal: expect.any(AbortSignal),
    },
  );
});
it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3, 4, 5])])(
  "refuses truncated and oversized bodies even when their declared length looks correct",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "image/jpeg", "content-length": "4" },
          }),
      ),
    );
    await expect(
      new ApiClient("https://api.test.invalid").downloadVisualFile(
        "token",
        f.storeId,
        manifest,
        "preview",
      ),
    ).rejects.toMatchObject({ response: { code: "VISUAL_FILE_INVALID" } });
  },
);
it("refuses HTML and foreign-store manifests before using their bytes", async () => {
  const fetch = vi.fn(
    async () =>
      new Response("html", {
        headers: { "content-type": "text/html", "content-length": "4" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient("https://api.test.invalid");
  await expect(
    client.downloadVisualFile("token", f.actorId, manifest, "preview"),
  ).rejects.toThrow("VISUAL_SCOPE_INVALID");
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    client.downloadVisualFile("token", f.storeId, manifest, "preview"),
  ).rejects.toMatchObject({ response: { code: "VISUAL_FILE_INVALID" } });
});
it.each([true, false])(
  "bounds the native arrayBuffer fallback by the advertised manifest size (%s)",
  async (declared) => {
    const arrayBuffer = vi.fn(async () => bytes.buffer);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers({
              "content-type": "image/jpeg",
              ...(declared ? { "content-length": "4" } : {}),
            }),
            body: null,
            arrayBuffer,
          }) as unknown as Response,
      ),
    );
    const result = new ApiClient("https://api.test.invalid").downloadVisualFile(
      "token",
      f.storeId,
      manifest,
      "preview",
    );
    if (declared) {
      expect(await result).toEqual(bytes);
      expect(arrayBuffer).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({
        response: {
          code: "VISUAL_FILE_INVALID",
        },
      });
      expect(arrayBuffer).not.toHaveBeenCalled();
    }
  },
);
