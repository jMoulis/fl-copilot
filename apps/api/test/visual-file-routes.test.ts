import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import type { VisualFileService } from "../src/products/visual-file-service";
import { visualBytesHash } from "../src/products/visual-image-normalization";
it("authenticates every private image route, limits writers and serves an opaque noncacheable body", async () => {
  const storeId = randomUUID(),
    assetId = randomUUID(),
    userId = randomUUID(),
    uploadId = randomUUID();
  let role = "MANAGER";
  const manifest = {
    assetId,
    storeId,
    processorVersion: "visual-image.v1" as const,
    source: {
      contentHash: `sha256:${"a".repeat(64)}`,
      mimeType: "image/jpeg" as const,
      sizeBytes: 4,
      width: 1,
      height: 1,
    },
    preview: {
      contentHash: `sha256:${"b".repeat(64)}`,
      mimeType: "image/jpeg" as const,
      sizeBytes: 4,
      width: 1,
      height: 1,
    },
  };
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const files: VisualFileService = {
    init: vi.fn(async () => ({
      state: "READY" as const,
      uploadId: null,
      uploadUrl: null,
      expiresAt: null,
      headers: {},
      manifest,
    })),
    complete: vi.fn(async () => manifest),
    manifest: vi.fn(async () => manifest),
    read: vi.fn(async () => ({
      bytes,
      mimeType: "image/jpeg",
      contentHash: visualBytesHash(bytes),
    })),
  };
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, store) => {
      if (token !== "valid" || store !== storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Magasin non autorisé.");
      return {
        storeId,
        userId,
        role,
        storeName: "Test",
        deviceId: randomUUID(),
        sessionId: randomUUID(),
      };
    }),
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb: vi.fn(),
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth,
    visualFiles: files,
  });
  try {
    for (const req of [
      {
        method: "POST" as const,
        url: "/api/v1/visual-files/init",
        payload: { assetId },
      },
      {
        method: "POST" as const,
        url: "/api/v1/visual-files/complete",
        payload: { assetId, uploadId },
      },
      {
        method: "GET" as const,
        url: `/api/v1/visual-assets/${assetId}/file-manifest`,
      },
      {
        method: "GET" as const,
        url: `/api/v1/visual-assets/${assetId}/preview`,
      },
      {
        method: "GET" as const,
        url: `/api/v1/visual-assets/${assetId}/source`,
      },
    ]) {
      expect((await app.inject(req)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            ...req,
            headers: { authorization: "Bearer valid" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            ...req,
            headers: {
              authorization: "Bearer valid",
              "x-store-id": randomUUID(),
            },
          })
        ).statusCode,
      ).toBe(403);
    }
    for (const fn of Object.values(files)) expect(fn).not.toHaveBeenCalled();
    const headers = { authorization: "Bearer valid", "x-store-id": storeId };
    role = "STAFF";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/visual-files/init",
          payload: { assetId },
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/visual-files/complete",
          payload: { assetId, uploadId },
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/v1/visual-assets/${assetId}/source`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/v1/visual-assets/${assetId}/unknown`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: "/api/v1/visual-assets/not-a-uuid/preview",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    role = "MANAGER";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/visual-files/init",
          payload: { assetId, sourceKey: "foreign-file" },
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/visual-files/init",
          payload: { assetId },
          headers,
        })
      ).json(),
    ).toMatchObject({ state: "READY", manifest });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/visual-files/complete",
          payload: { assetId, uploadId },
          headers,
        })
      ).json(),
    ).toEqual(manifest);
    const response = await app.inject({
      url: `/api/v1/visual-assets/${assetId}/preview`,
      headers,
    });
    expect(response.rawPayload).toEqual(Buffer.from(bytes));
    expect(response.headers).toMatchObject({
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-length": "4",
      etag: `"${visualBytesHash(bytes).slice(7)}"`,
    });
    expect(files.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ storeId, userId }),
      assetId,
      "preview",
    );
  } finally {
    await app.close();
  }
});
