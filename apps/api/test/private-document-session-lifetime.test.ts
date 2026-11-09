import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
const signing = vi.hoisted(() => ({ finish: () => {} }));
vi.mock("../src/uploads/private-original-link.js", () => ({
  signPrivateOriginal: async () => {
    signing.finish();
    return "https://test.private.blob.vercel-storage.com/original?token=private-test-only";
  },
}));
const operations = [
  "upload-init",
  "upload-complete",
  "commercial-link",
  "layout-manifest",
  "layout-source",
  "layout-image",
  "layout-original",
  "layout-data",
] as const;
it.each(
  operations.flatMap((operation) =>
    ["session", "membership"].map((change) => ({ operation, change })),
  ),
)(
  "refuses $operation after $change withdrawal during preparation",
  async ({ operation, change }) => {
    const storeId = randomUUID(),
      userId = randomUUID(),
      id = randomUUID(),
      uploadId = randomUUID();
    let revoked = false;
    const retire = () => {
      revoked = true;
    };
    signing.finish = retire;
    const auth: AuthService = {
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      authorizeStore: vi.fn(async () => {
        if (revoked)
          throw new AuthError(
            change === "session" ? 401 : 403,
            "ACCESS_RETIRED",
            "Accès retiré.",
          );
        return {
          storeId,
          userId,
          role: "MANAGER",
          storeName: "Test",
          deviceId: randomUUID(),
          sessionId: randomUUID(),
        };
      }),
    };
    const bytes = new Uint8Array([0xca, 0xfe, 0xf0, 0x0d]);
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth,
      database: {
        getDb: vi.fn(
          async () =>
            ({
              collection: () => ({
                findOne: async () => ({
                  _id: id,
                  storeId,
                  sourceType: "WEEKLY_COMMERCIAL_PDF",
                  remoteUploadStatus: "CONFIRMED",
                  objectKey: "test-original.pdf",
                  originalFilename: "document.pdf",
                  deletedAt: null,
                }),
              }),
            }) as unknown as Db,
        ),
        checkHealth: async () => "connected",
        close: async () => {},
      },
      sourceUploads: {
        init: vi.fn(async () => {
          retire();
          return {
            uploadId,
            objectKey: "test-original.pdf",
            status: "UPLOAD_REQUIRED" as const,
            uploadUrl:
              "https://test.private.blob.vercel-storage.com/upload?token=private-test-only",
            expiresAt: "2026-11-10T00:00:00Z",
            headers: {},
          };
        }),
        complete: vi.fn(async () => {
          retire();
          return {
            sourceDocumentId: id,
            remoteUploadStatus: "CONFIRMED" as const,
            jobId: null,
          };
        }),
      },
      layoutIllustrationFiles: {
        persist: vi.fn(),
        recover: vi.fn(),
        manifest: vi.fn(async () => {
          retire();
          return { state: "EMPTY" as const, preparationId: id };
        }),
        read: vi.fn(async () => {
          retire();
          return {
            bytes,
            mimeType: "image/png" as const,
            checksum: `sha256:${"a".repeat(64)}`,
          };
        }),
      },
    });
    const checksum = `sha256:${"b".repeat(64)}`;
    const request =
      operation === "upload-init"
        ? {
            method: "POST" as const,
            url: "/api/v1/uploads/init",
            payload: {
              sourceDocumentId: id,
              sourceType: "WEEKLY_COMMERCIAL_PDF",
              filename: "document.pdf",
              mimeType: "application/pdf",
              sizeBytes: 100,
              checksum,
            },
          }
        : operation === "upload-complete"
          ? {
              method: "POST" as const,
              url: `/api/v1/uploads/${uploadId}/complete`,
              payload: { sizeBytes: 100, checksum },
            }
          : {
              method: "GET" as const,
              url:
                operation === "commercial-link"
                  ? `/api/v1/commercial/${id}/original-link`
                  : operation === "layout-manifest"
                    ? `/api/v1/copilot/layout-illustrations/${id}/manifest`
                    : `/api/v1/copilot/layout-illustrations/${id}/results/${uploadId}/${operation.slice(7)}`,
            };
    try {
      const response = await app.inject({
        ...request,
        headers: { authorization: "Bearer valid", "x-store-id": storeId },
      });
      expect(response.statusCode).toBe(change === "session" ? 401 : 403);
      expect(auth.authorizeStore).toHaveBeenCalledTimes(2);
      expect(response.rawPayload).not.toEqual(Buffer.from(bytes));
      expect(response.body).not.toContain("private-test-only");
      expect(response.headers["content-type"]).toContain("application/json");
    } finally {
      signing.finish = () => {};
      await app.close();
    }
  },
);
