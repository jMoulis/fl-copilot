import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { illustrationAssetsFixture } from "../../../scripts/test-layout-illustration-assets";
import type { LayoutIllustrationFiles } from "../src/copilot/layout-illustration-files";
it("authenticates every illustration manifest/file read, streams exact private bytes and exposes no result write route", async () => {
  const f = await illustrationAssetsFixture(),
    scope = { storeId: f.scope.storeId, userId: f.scope.ownerId };
  const files: LayoutIllustrationFiles = {
    manifest: vi.fn(async () => ({
      state: "READY" as const,
      manifest: f.manifest,
    })),
    read: vi.fn(
      async (...args: Parameters<LayoutIllustrationFiles["read"]>) => {
        const v = args[3];
        return {
          bytes: f.bytes[v],
          mimeType: f.manifest.files[v].mimeType,
          checksum: f.manifest.files[v].checksum,
        };
      },
    ),
    persist: vi.fn(),
    recover: vi.fn(),
  };
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, store) => {
      if (token !== "valid" || store !== scope.storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Magasin non autorisé.");
      return {
        ...scope,
        role: "STAFF",
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
    layoutIllustrationFiles: files,
  });
  try {
    const prefix = `/api/v1/copilot/layout-illustrations/${f.preparation.id}`,
      headers = { authorization: "Bearer valid", "x-store-id": scope.storeId };
    for (const url of [
      `${prefix}/manifest`,
      ...(["source", "image", "original", "data"] as const).map(
        (v) => `${prefix}/results/${f.manifest.id}/${v}`,
      ),
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (await app.inject({ url, headers: { authorization: "Bearer valid" } }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            url,
            headers: { ...headers, "x-store-id": randomUUID() },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(files.read).not.toHaveBeenCalled();
    const manifest = await app.inject({ url: `${prefix}/manifest`, headers });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().manifest).toEqual(f.manifest);
    expect(manifest.headers["cache-control"]).toBe("private, no-store");
    for (const v of ["source", "original", "image", "data"] as const) {
      const reply = await app.inject({
        url: `${prefix}/results/${f.manifest.id}/${v}`,
        headers,
      });
      expect(reply.statusCode).toBe(200);
      expect(new Uint8Array(reply.rawPayload)).toEqual(f.bytes[v]);
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${prefix}/results`,
          headers,
          payload: { image: "no" },
        })
      ).statusCode,
    ).toBe(404);
    expect(files.persist).not.toHaveBeenCalled();
  } finally {
    await app.close();
    f.db.close();
  }
});
