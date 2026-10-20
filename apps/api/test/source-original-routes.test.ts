import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import type { SourceOriginalService } from "../src/uploads/source-original-service";
it("authenticates source capabilities, rechecks membership and prevents caching without accepting model-controlled paths", async () => {
  const storeId = randomUUID(),
    userId = randomUUID(),
    id = randomUUID();
  let revoked = false;
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, store) => {
      if (token !== "valid" || store !== storeId || revoked)
        throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé.");
      return {
        storeId,
        userId,
        role: "USER",
        storeName: "Test",
        deviceId: randomUUID(),
        sessionId: randomUUID(),
      };
    }),
  };
  const manifest = {
    schemaVersion: 1 as const,
    sourceDocumentId: id,
    storeId,
    sourceType: "MERCALYS_SALES" as const,
    access: "STORE" as const,
    ownerId: null,
    filename: "ventes.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
    sizeBytes: 100,
    checksum: `sha256:${"a".repeat(64)}`,
    registeredAt: "2026-10-20T12:00:00Z",
    objectVersion: "version",
    manifestHash: `sha256:${"b".repeat(64)}`,
  };
  const files: SourceOriginalService = {
    manifest: vi.fn(async (_store, _actor, _id, authorize) => {
      await authorize?.();
      return manifest;
    }),
    download: vi.fn(async (_store, _actor, _id, authorize) => {
      await authorize?.();
      return {
        manifest,
        url: "https://test.private.blob.vercel-storage.com/file?token=test-only",
        expiresAt: "2026-10-20T12:02:00Z",
      };
    }),
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    auth,
    sourceOriginals: files,
    database: {
      getDb: vi.fn(),
      checkHealth: async () => "connected",
      close: async () => {},
    },
  });
  try {
    for (const operation of ["manifest", "download"] as const) {
      const url = `/api/v1/source-documents/${id}/original-${operation}`;
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (await app.inject({ url, headers: { authorization: "Bearer valid" } }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            url,
            headers: {
              authorization: "Bearer valid",
              "x-store-id": randomUUID(),
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(files[operation]).not.toHaveBeenCalled();
      const response = await app.inject({
        url,
        headers: { authorization: "Bearer valid", "x-store-id": storeId },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(files[operation]).toHaveBeenCalledWith(
        storeId,
        userId,
        id,
        expect.any(Function),
      );
    }
    files.download = vi.fn(async (_s, _u, _id, authorize) => {
      revoked = true;
      await authorize?.();
      throw Error("unreachable");
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/source-documents/${id}/original-download`,
          headers: { authorization: "Bearer valid", "x-store-id": storeId },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
