import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import type { VisualFileService } from "../src/products/visual-file-service";

const routes = [
  {
    method: "POST" as const,
    path: "/visual-files/init",
    operation: "init",
    write: true,
  },
  {
    method: "POST" as const,
    path: "/visual-files/complete",
    operation: "complete",
    write: true,
  },
  ...[
    "file-manifest",
    "source",
    "preview",
    "file-manifest?preview=transparent",
    "preview?preview=transparent",
  ].map((variant) => ({
    method: "GET" as const,
    path: "/visual-assets/ASSET/" + variant,
    operation: variant.startsWith("file-manifest") ? "manifest" : "read",
    write: false,
  })),
];
const cases = routes.flatMap((route) =>
  ["session", "membership", ...(route.write ? ["manager-role"] : [])].map(
    (change) => ({ ...route, change }),
  ),
);

it.each(cases)(
  "refuses $path after $change changes while preparing its result",
  async ({ method, path, operation, write, change }) => {
    const storeId = randomUUID(),
      userId = randomUUID(),
      assetId = randomUUID(),
      uploadId = randomUUID();
    let changed = false;
    const auth: AuthService = {
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      authorizeStore: vi.fn(async () => {
        if (changed && change !== "manager-role")
          throw new AuthError(
            change === "session" ? 401 : 403,
            "ACCESS_RETIRED",
            "Accès retiré.",
          );
        return {
          storeId,
          userId,
          role: changed ? "STAFF" : "MANAGER",
          storeName: "Test",
          deviceId: randomUUID(),
          sessionId: randomUUID(),
        };
      }),
    };
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
    const bytes = Buffer.from([0xca, 0xfe, 0xf0, 0x0d]);
    const files: VisualFileService = {
      init: vi.fn(async () => {
        changed = true;
        return {
          state: "UPLOAD_REQUIRED" as const,
          uploadId,
          uploadUrl:
            "https://private.example.test/upload?token=private-test-only",
          expiresAt: "2026-11-10T00:00:00Z",
          headers: {},
          manifest: null,
        };
      }),
      complete: vi.fn(async () => {
        changed = true;
        return manifest;
      }),
      manifest: vi.fn(async () => {
        changed = true;
        return manifest;
      }),
      read: vi.fn(async () => {
        changed = true;
        return {
          bytes,
          mimeType: "image/jpeg",
          contentHash: manifest.preview.contentHash,
        };
      }),
    };
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth,
      visualFiles: files,
      database: {
        getDb: vi.fn(),
        checkHealth: async () => "connected",
        close: async () => {},
      },
    });
    try {
      const result = await app.inject({
        method,
        url: "/api/v1" + path.replace("ASSET", assetId),
        headers: { authorization: "Bearer valid", "x-store-id": storeId },
        ...(write
          ? {
              payload:
                operation === "init" ? { assetId } : { assetId, uploadId },
            }
          : {}),
      });
      expect(result.statusCode).toBe(change === "session" ? 401 : 403);
      expect(auth.authorizeStore).toHaveBeenCalledTimes(2);
      expect(result.rawPayload).not.toEqual(bytes);
      expect(result.body).not.toContain("private-test-only");
      expect(result.body).not.toContain(manifest.source.contentHash);
      expect(result.headers["content-type"]).toContain("application/json");
    } finally {
      await app.close();
    }
  },
);
