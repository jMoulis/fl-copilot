import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";
afterEach(() => vi.unstubAllGlobals());
it("requests original manifests and capabilities only through authenticated scoped source IDs", async () => {
  const storeId = "11111111-1111-4111-8111-111111111111",
    sourceId = "22222222-2222-4222-8222-222222222222";
  const manifest = {
    schemaVersion: 1,
    sourceDocumentId: sourceId,
    storeId,
    access: "STORE",
    ownerId: null,
    sourceType: "MERCALYS_SALES",
    filename: "original.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 100,
    checksum: `sha256:${"a".repeat(64)}`,
    registeredAt: "2026-10-20T12:00:00Z",
    objectVersion: "version",
    manifestHash: `sha256:${"b".repeat(64)}`,
  };
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("original-manifest")
            ? manifest
            : {
                manifest,
                url: "https://test.private.blob.vercel-storage.com/file?test-only=1",
                expiresAt: "2026-10-20T13:02:00Z",
              },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient("https://api.test.invalid");
  expect(
    await api.sourceOriginalManifest("test-token", storeId, sourceId),
  ).toEqual(manifest);
  expect(
    (await api.sourceOriginalDownload("test-token", storeId, sourceId))
      .manifest,
  ).toEqual(manifest);
  expect(fetch.mock.calls).toMatchObject([
    [
      `https://api.test.invalid/api/v1/source-documents/${sourceId}/original-manifest`,
      {
        method: "GET",
        headers: { authorization: "Bearer test-token", "x-store-id": storeId },
      },
    ],
    [
      `https://api.test.invalid/api/v1/source-documents/${sourceId}/original-download`,
      {
        method: "GET",
        headers: { authorization: "Bearer test-token", "x-store-id": storeId },
      },
    ],
  ]);
});
