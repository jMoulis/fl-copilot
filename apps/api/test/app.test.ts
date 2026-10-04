import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  bootstrapResponseSchema,
  healthResponseSchema,
  importVerificationResultSchema,
  initSourceUploadResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from "@fl-copilot/sync-contracts";
import { buildApp } from "../src/build-app.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService, DatabaseStatus } from "../src/database/types.js";
import {
  createConfiguredCodeSender,
  type AuthService,
  type ResendEmailClient,
} from "../src/auth/service.js";
import type { SyncPushService } from "../src/sync/push-service.js";
import type { SyncPullService } from "../src/sync/pull-service.js";
import type { SyncBootstrapService } from "../src/sync/bootstrap-service.js";
import type { SourceUploadService } from "../src/uploads/source-upload-service.js";
import type { ImportVerificationService } from "../src/imports/import-verification-service.js";
const apps: ReturnType<typeof buildApp>[] = [];
function createDatabase(status: DatabaseStatus = "connected"): DatabaseService {
  return {
    checkHealth: async () => status,
    getDb: async () => {
      throw new Error("Database access is not expected in API unit tests");
    },
    close: async () => undefined,
  };
}
function createApp(
  status: DatabaseStatus = "connected",
  environment: Record<string, string> = {},
) {
  const app = buildApp(parseEnvironment({ NODE_ENV: "test", ...environment }), {
    database: createDatabase(status),
  });
  apps.push(app);
  return app;
}
function createAuthApp(
  auth: AuthService,
  syncPush?: SyncPushService,
  syncPull?: SyncPullService,
  syncBootstrap?: SyncBootstrapService,
  sourceUploads?: SourceUploadService,
  importVerification?: ImportVerificationService,
) {
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: createDatabase(),
    auth,
    syncBootstrap,
    syncPull,
    syncPush,
    sourceUploads,
    importVerification,
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("source upload routes", () => {
  const storeId = "44444444-4444-4444-8444-444444444444";
  const sourceDocumentId = "55555555-5555-4555-8555-555555555555";
  const uploadId = "66666666-6666-4666-8666-666666666666";
  const checksum = `sha256:${"a".repeat(64)}`;

  function fakeAuth(): AuthService {
    return {
      requestChallenge: async () => {
        throw new Error("not used");
      },
      verifyChallenge: async () => {
        throw new Error("not used");
      },
      refreshSession: async () => {
        throw new Error("not used");
      },
      authorizeStore: async (_token, authorizedStoreId) => ({
        userId: "77777777-7777-4777-8777-777777777777",
        sessionId: "88888888-8888-4888-8888-888888888888",
        deviceId: "99999999-9999-4999-8999-999999999999",
        storeId: authorizedStoreId,
        storeName: "Magasin test",
        role: "MANAGER",
      }),
      logout: async () => undefined,
    };
  }

  it("authorizes a scoped private upload and confirms it", async () => {
    const calls: string[] = [];
    const uploads: SourceUploadService = {
      init: async (authorizedStoreId, userId, input) => {
        calls.push(
          `init:${authorizedStoreId}:${userId}:${input.sourceDocumentId}`,
        );
        return {
          uploadId,
          objectKey: `sources/${storeId}/${sourceDocumentId}/file.xlsx`,
          status: "UPLOAD_REQUIRED",
          uploadUrl: "https://blob.example.test/presigned",
          expiresAt: "2026-10-03T12:10:00.000Z",
          headers: { "content-type": input.mimeType },
        };
      },
      complete: async (authorizedStoreId, authorizedUploadId, input) => {
        calls.push(
          `complete:${authorizedStoreId}:${authorizedUploadId}:${input.sizeBytes}`,
        );
        return {
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
        };
      },
    };
    const app = createAuthApp(
      fakeAuth(),
      undefined,
      undefined,
      undefined,
      uploads,
    );
    const headers = {
      authorization: "Bearer access-token",
      "x-store-id": storeId,
    };
    const initialized = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers,
      payload: {
        sourceDocumentId,
        sourceType: "MERCALYS_SALES",
        filename: "ventes.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 27_700,
        checksum,
      },
    });
    expect(initialized.statusCode).toBe(200);
    expect(
      initSourceUploadResponseSchema.parse(initialized.json()),
    ).toMatchObject({
      uploadId,
      status: "UPLOAD_REQUIRED",
    });

    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers,
      payload: { sizeBytes: 27_700, checksum },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      sourceDocumentId,
      remoteUploadStatus: "CONFIRMED",
    });
    expect(calls).toEqual([
      `init:${storeId}:77777777-7777-4777-8777-777777777777:${sourceDocumentId}`,
      `complete:${storeId}:${uploadId}:27700`,
    ]);
  });

  it("rejects anonymous and invalid upload requests before issuing a URL", async () => {
    const uploads: SourceUploadService = {
      init: async () => {
        throw new Error("must not run");
      },
      complete: async () => {
        throw new Error("must not run");
      },
    };
    const app = createAuthApp(
      fakeAuth(),
      undefined,
      undefined,
      undefined,
      uploads,
    );
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: { "x-store-id": storeId },
      payload: {},
    });
    expect(anonymous.statusCode).toBe(400);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
      },
      payload: {
        sourceDocumentId,
        sourceType: "MERCALYS_SALES",
        filename: "ventes.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1,
        checksum,
      },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe("import verification route", () => {
  const storeId = "44444444-4444-4444-8444-444444444444";
  const sourceDocumentId = "55555555-5555-4555-8555-555555555555";
  const checksum = `sha256:${"a".repeat(64)}`;

  const auth: AuthService = {
    requestChallenge: async () => {
      throw new Error("not used");
    },
    verifyChallenge: async () => {
      throw new Error("not used");
    },
    refreshSession: async () => {
      throw new Error("not used");
    },
    authorizeStore: async (_token, authorizedStoreId) => ({
      userId: "77777777-7777-4777-8777-777777777777",
      sessionId: "88888888-8888-4888-8888-888888888888",
      deviceId: "99999999-9999-4999-8999-999999999999",
      storeId: authorizedStoreId,
      storeName: "Magasin test",
      role: "MANAGER",
    }),
    logout: async () => undefined,
  };

  it("authorizes the store and returns the shared verification result", async () => {
    let verifiedStoreId: string | undefined;
    const verification: ImportVerificationService = {
      verify: async (authorizedStoreId, verifiedDocumentId, input) => {
        verifiedStoreId = authorizedStoreId;
        return {
          sourceDocumentId: verifiedDocumentId,
          status: "MATCH",
          localFingerprint: input.localNormalizedFingerprint,
          remoteFingerprint: input.localNormalizedFingerprint,
        };
      },
    };
    const app = createAuthApp(
      auth,
      undefined,
      undefined,
      undefined,
      undefined,
      verification,
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/imports/${sourceDocumentId}/verify`,
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
      },
      payload: {
        sourceType: "MERCALYS_SALES",
        checksum,
        businessPeriodStart: "2026-09-26",
        businessPeriodEnd: "2026-09-26",
        localNormalizedFingerprint: "fnv1a64:0123456789abcdef",
        localRecordCount: 147,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(verifiedStoreId).toBe(storeId);
    expect(importVerificationResultSchema.parse(response.json())).toMatchObject(
      { sourceDocumentId, status: "MATCH" },
    );
  });

  it("rejects an anonymous verification before reading the source", async () => {
    const app = createAuthApp(
      auth,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        verify: async () => {
          throw new Error("must not verify");
        },
      },
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/imports/${sourceDocumentId}/verify`,
      payload: {
        sourceType: "MERCALYS_SALES",
        checksum,
        businessPeriodStart: "2026-09-26",
        businessPeriodEnd: "2026-09-26",
        localNormalizedFingerprint: "fnv1a64:0123456789abcdef",
        localRecordCount: 147,
      },
    });
    expect(response.statusCode).toBe(401);
  });
});
describe("API foundation", () => {
  it("exposes public process liveness with the shared response contract", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: "ok",
      service: "fl-copilot-api",
      database: { status: "connected" },
    });
  });
  it("reports degraded readiness while MongoDB is unavailable", async () => {
    const response = await createApp("disconnected").inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(503);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: "degraded",
      service: "fl-copilot-api",
      database: { status: "disconnected" },
    });
  });
  it("generates unique server-owned request IDs rather than trusting caller headers", async () => {
    const app = createApp();
    const first = await app.inject({
      url: "/health",
      headers: { "x-request-id": "untrusted" },
    });
    const second = await app.inject({ url: "/health" });
    expect(first.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"],
    );
  });
  it("returns French structured errors with matching correlation IDs", async () => {
    const response = await createApp().inject({ url: "/unknown" });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json())).toMatchObject({
      code: "NOT_FOUND",
      retryable: false,
      requestId: response.headers["x-request-id"],
    });
  });
  it("validates requests with Zod and does not echo rejected input", async () => {
    const app = createApp();
    app.post(
      "/test/validation",
      { schema: { body: z.object({ quantity: z.number().positive() }) } },
      (request) => request.body,
    );
    const response = await app.inject({
      method: "POST",
      url: "/test/validation",
      payload: { quantity: "secret input" },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).code).toBe("VALIDATION_ERROR");
    expect(response.body).not.toContain("secret input");
    const valid = await app.inject({
      method: "POST",
      url: "/test/validation",
      payload: { quantity: 2 },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ quantity: 2 });
  });
  it("normalizes malformed JSON and oversized requests", async () => {
    const app = createApp();
    app.post("/test/body", (request) => request.body);
    const malformed = await app.inject({
      method: "POST",
      url: "/test/body",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });
    expect(malformed.statusCode).toBe(400);
    expect(apiErrorSchema.parse(malformed.json()).code).toBe(
      "VALIDATION_ERROR",
    );
    const large = await app.inject({
      method: "POST",
      url: "/test/body",
      payload: { data: "x".repeat(1024 * 1024) },
    });
    expect(large.statusCode).toBe(413);
    expect(apiErrorSchema.parse(large.json()).retryable).toBe(false);
  });
  it("hides unexpected exception details", async () => {
    const app = createApp();
    app.get("/test/failure", () => {
      throw new Error("secret database credentials");
    });
    const response = await app.inject({ url: "/test/failure" });
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).retryable).toBe(true);
    expect(response.body).not.toContain("secret");
  });
  it("exposes the deliberate monitoring error only outside production", async () => {
    const development = await createApp("connected", {
      SENTRY_TEST_ROUTE_ENABLED: "true",
    }).inject({
      method: "POST",
      url: "/api/v1/observability/test-error",
    });
    expect(development.statusCode).toBe(500);
    expect(apiErrorSchema.parse(development.json()).code).toBe(
      "INTERNAL_ERROR",
    );

    const disabled = await createApp().inject({
      method: "POST",
      url: "/api/v1/observability/test-error",
    });
    expect(disabled.statusCode).toBe(404);
  });
  it("rejects an invalid response through the response schema", async () => {
    const app = createApp();
    app.get(
      "/test/response",
      { schema: { response: { 200: z.object({ count: z.number() }) } } },
      () => ({ count: NaN }),
    );
    const response = await app.inject({ url: "/test/response" });
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).code).toBe("INTERNAL_ERROR");
  });
});
describe("environment validation", () => {
  it("uses safe local defaults", () => {
    expect(parseEnvironment({})).toMatchObject({
      HOST: "127.0.0.1",
      PORT: 3000,
      MONGODB_DATABASE: "fl_copilot",
      MONGODB_MAX_POOL_SIZE: 20,
      MONGODB_URI: "mongodb://127.0.0.1:27017/?directConnection=true",
    });
  });
  it.each(["0", "-1", "65536", "abc", "3.5", ""])(
    "rejects invalid port %s",
    (PORT) => {
      expect(() => parseEnvironment({ PORT })).toThrow("PORT");
    },
  );
  it("does not leak invalid configuration values", () => {
    expect(() => parseEnvironment({ LOG_LEVEL: "secret-value" })).toThrow(
      "Invalid environment: LOG_LEVEL",
    );
  });
  it("requires an explicit MongoDB URI in production", () => {
    expect(() => parseEnvironment({ NODE_ENV: "production" })).toThrow(
      "Invalid environment: MONGODB_URI",
    );
  });
  it("requires authentication secrets in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
      }),
    ).toThrow("AUTH_TOKEN_SECRET");
  });
  it("requires Resend delivery settings in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
        AUTH_TOKEN_SECRET: "t".repeat(32),
        AUTH_CODE_PEPPER: "p".repeat(32),
      }),
    ).toThrow("RESEND_API_KEY");
  });

  it("accepts complete production delivery and Vision settings", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
        AUTH_TOKEN_SECRET: "t".repeat(32),
        AUTH_CODE_PEPPER: "p".repeat(32),
        RESEND_API_KEY: "re_production_key",
        AUTH_EMAIL_FROM: "connexion@auth.example.com",
        OPENAI_API_KEY: `sk-${"a".repeat(40)}`,
      }),
    ).toMatchObject({
      RESEND_API_KEY: "re_production_key",
      AUTH_EMAIL_FROM: "connexion@auth.example.com",
      OPENAI_API_KEY: `sk-${"a".repeat(40)}`,
      WASTE_RECEIPT_VISION_MODEL: "gpt-5.6-luna",
    });
  });
  it("requires OpenAI or Vercel AI Gateway credentials in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
        AUTH_TOKEN_SECRET: "t".repeat(32),
        AUTH_CODE_PEPPER: "p".repeat(32),
        RESEND_API_KEY: "re_production_key",
        AUTH_EMAIL_FROM: "connexion@auth.example.com",
      }),
    ).toThrow("VERCEL_OIDC_TOKEN");
  });
  it("forbids the deliberate monitoring route in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
        AUTH_TOKEN_SECRET: "t".repeat(32),
        AUTH_CODE_PEPPER: "p".repeat(32),
        RESEND_API_KEY: "re_production_key",
        AUTH_EMAIL_FROM: "connexion@auth.example.com",
        OPENAI_API_KEY: `sk-${"a".repeat(40)}`,
        SENTRY_TEST_ROUTE_ENABLED: "true",
      }),
    ).toThrow("SENTRY_TEST_ROUTE_ENABLED");
  });
});

describe("Resend authentication email delivery", () => {
  const input = {
    challengeId: "11111111-1111-4111-8111-111111111111",
    email: "manager@example.test",
    code: "123456",
    expiresAt: new Date("2026-09-25T20:00:00.000Z"),
  };
  const config = parseEnvironment({
    NODE_ENV: "test",
    RESEND_API_KEY: "re_test_api_key",
    AUTH_EMAIL_FROM: "connexion@auth.example.com",
  });

  it("sends a French code email once per challenge", async () => {
    const deliveries: Array<{
      email: Parameters<ResendEmailClient["send"]>[0];
      options: Parameters<ResendEmailClient["send"]>[1];
    }> = [];
    const client: ResendEmailClient = {
      send: async (email, options) => {
        deliveries.push({ email, options });
        return { error: null };
      },
    };

    await createConfiguredCodeSender(config, client)(input);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      email: {
        from: "F&L Copilot <connexion@auth.example.com>",
        to: "manager@example.test",
        subject: "Votre code de connexion F&L Copilot",
        tags: [{ name: "category", value: "authentication" }],
      },
      options: {
        idempotencyKey: "auth-challenge/11111111-1111-4111-8111-111111111111",
      },
    });
    expect(deliveries[0]?.email.text).toContain("123456");
    expect(deliveries[0]?.email.html).toContain("123456");
  });

  it("returns a retryable public error when Resend rejects delivery", async () => {
    const client: ResendEmailClient = {
      send: async () => ({ error: { message: "private provider detail" } }),
    };

    await expect(
      createConfiguredCodeSender(config, client)(input),
    ).rejects.toMatchObject({
      statusCode: 503,
      publicCode: "AUTH_DELIVERY_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("authentication routes", () => {
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const session = {
    accessToken: "header.payload.signature",
    accessTokenExpiresAt: "2026-09-16T20:00:00.000Z",
    refreshToken: "r".repeat(43),
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "manager@example.test",
      displayName: "Manager",
    },
    stores: [],
  };

  function fakeAuth(): AuthService {
    return {
      requestChallenge: async () => ({
        challengeId,
        expiresAt: "2026-09-16T20:00:00.000Z",
      }),
      verifyChallenge: async () => session,
      refreshSession: async () => session,
      authorizeStore: async (_accessToken, storeId, deviceId) => ({
        userId: session.user.id,
        sessionId: "44444444-4444-4444-8444-444444444444",
        deviceId: deviceId ?? "33333333-3333-4333-8333-333333333333",
        storeId,
        storeName: "Magasin test",
        role: "MANAGER",
      }),
      logout: async () => undefined,
    };
  }

  it("validates and creates an email-code challenge", async () => {
    const app = createAuthApp(fakeAuth());
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/auth/challenges",
      payload: { email: "invalid" },
    });
    expect(invalid.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/challenges",
      payload: {
        email: "MANAGER@example.test",
        deviceId: "33333333-3333-4333-8333-333333333333",
        platform: "IOS",
        appVersion: "0.1.0",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(authChallengeResponseSchema.parse(response.json()).challengeId).toBe(
      challengeId,
    );
  });

  it("verifies codes, refreshes sessions and requires a bearer token to logout", async () => {
    const app = createAuthApp(fakeAuth());
    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/auth/challenges/${challengeId}/verify`,
      payload: { code: "123456" },
    });
    expect(verified.statusCode).toBe(200);
    expect(authSessionResponseSchema.parse(verified.json()).user.email).toBe(
      "manager@example.test",
    );

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        deviceId: "33333333-3333-4333-8333-333333333333",
        refreshToken: "r".repeat(43),
      },
    });
    expect(refreshed.statusCode).toBe(200);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
    });
    expect(unauthorized.statusCode).toBe(401);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: "Bearer header.payload.signature" },
    });
    expect(logout.json()).toEqual({ revoked: true });
  });
});

describe("synchronization push route", () => {
  const deviceId = "33333333-3333-4333-8333-333333333333";
  const storeId = "44444444-4444-4444-8444-444444444444";
  const commandId = "55555555-5555-4555-8555-555555555555";
  const entityId = "66666666-6666-4666-8666-666666666666";
  const request = {
    syncProtocolVersion: 1 as const,
    appVersion: "0.1.0",
    deviceId,
    storeId,
    commands: [
      {
        commandId,
        localSequence: 1,
        type: "SYNC_TEST_ENTITY_UPSERT",
        entityType: "sync_test_entity",
        entityId,
        expectedRemoteVersion: null,
        createdAt: "2026-09-26T08:00:00.000Z",
        payload: {
          id: entityId,
          storeId,
          label: "Tomates",
          remoteVersion: 0,
          createdAt: "2026-09-26T08:00:00.000Z",
          updatedAt: "2026-09-26T08:00:00.000Z",
        },
      },
    ],
  };

  function fakeAuth(onAuthorize?: () => void): AuthService {
    return {
      requestChallenge: async () => {
        throw new Error("not used");
      },
      verifyChallenge: async () => {
        throw new Error("not used");
      },
      refreshSession: async () => {
        throw new Error("not used");
      },
      authorizeStore: async (
        _accessToken,
        authorizedStoreId,
        authorizedDeviceId,
      ) => {
        onAuthorize?.();
        return {
          userId: "77777777-7777-4777-8777-777777777777",
          sessionId: "88888888-8888-4888-8888-888888888888",
          deviceId: authorizedDeviceId ?? deviceId,
          storeId: authorizedStoreId,
          storeName: "Magasin test",
          role: "MANAGER",
        };
      },
      logout: async () => undefined,
    };
  }

  it("authorizes the store and returns the shared push response", async () => {
    let authorized = false;
    const syncPush: SyncPushService = {
      push: async (input) => ({
        results: input.commands.map((command) => ({
          commandId: command.commandId,
          status: "APPLIED" as const,
          entityType: command.entityType,
          entityId: command.entityId,
          remoteVersion: 1,
        })),
        serverTime: "2026-09-26T08:01:00.000Z",
      }),
    };
    const app = createAuthApp(
      fakeAuth(() => {
        authorized = true;
      }),
      syncPush,
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
      payload: request,
    });

    expect(response.statusCode).toBe(200);
    expect(authorized).toBe(true);
    expect(
      syncPushResponseSchema.parse(response.json()).results[0],
    ).toMatchObject({
      commandId,
      status: "APPLIED",
      remoteVersion: 1,
    });
  });

  it("requires authentication and matching store and protocol headers", async () => {
    const app = createAuthApp(fakeAuth(), {
      push: async () => {
        throw new Error("push must not run");
      },
    });
    const missingAuth = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: {
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
      payload: request,
    });
    expect(missingAuth.statusCode).toBe(401);

    const wrongStore = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": "99999999-9999-4999-8999-999999999999",
        "x-sync-protocol-version": "1",
      },
      payload: request,
    });
    expect(wrongStore.statusCode).toBe(403);

    const wrongProtocol = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "2",
      },
      payload: request,
    });
    expect(wrongProtocol.statusCode).toBe(400);
  });
});

describe("synchronization pull route", () => {
  const storeId = "44444444-4444-4444-8444-444444444444";
  const entityId = "66666666-6666-4666-8666-666666666666";

  function fakeAuth(onAuthorize: (storeId: string) => void): AuthService {
    return {
      requestChallenge: async () => {
        throw new Error("not used");
      },
      verifyChallenge: async () => {
        throw new Error("not used");
      },
      refreshSession: async () => {
        throw new Error("not used");
      },
      authorizeStore: async (_accessToken, authorizedStoreId) => {
        onAuthorize(authorizedStoreId);
        return {
          userId: "77777777-7777-4777-8777-777777777777",
          sessionId: "88888888-8888-4888-8888-888888888888",
          deviceId: "33333333-3333-4333-8333-333333333333",
          storeId: authorizedStoreId,
          storeName: "Magasin test",
          role: "MANAGER",
        };
      },
      logout: async () => undefined,
    };
  }

  it("authorizes the store and applies the bounded pull query", async () => {
    const authorizedStores: string[] = [];
    const syncPull: SyncPullService = {
      pull: async (pulledStoreId, query) => ({
        changes: [
          {
            sequence: "1",
            entityType: "sync_test_entity",
            entityId,
            operation: "UPSERT",
            entityVersion: 1,
            entity: { id: entityId },
            changedAt: "2026-09-26T08:00:00.000Z",
          },
        ],
        nextCursor: `${pulledStoreId}:${query.limit}`,
        hasMore: false,
        serverTime: "2026-09-26T08:01:00.000Z",
      }),
    };
    const app = createAuthApp(
      fakeAuth((authorizedStoreId) => authorizedStores.push(authorizedStoreId)),
      undefined,
      syncPull,
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sync/pull?limit=25",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authorizedStores).toEqual([storeId]);
    expect(syncPullResponseSchema.parse(response.json())).toMatchObject({
      nextCursor: `${storeId}:25`,
      hasMore: false,
    });
  });

  it("rejects missing context headers and invalid page limits", async () => {
    const app = createAuthApp(
      fakeAuth(() => undefined),
      undefined,
      {
        pull: async () => {
          throw new Error("pull must not run");
        },
      },
    );
    const missingStore = await app.inject({
      method: "GET",
      url: "/api/v1/sync/pull",
      headers: {
        authorization: "Bearer access-token",
        "x-sync-protocol-version": "1",
      },
    });
    expect(missingStore.statusCode).toBe(400);

    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/v1/sync/pull?limit=501",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
    });
    expect(invalidLimit.statusCode).toBe(400);
  });
});

describe("synchronization bootstrap route", () => {
  const storeId = "44444444-4444-4444-8444-444444444444";

  function fakeAuth(): AuthService {
    return {
      requestChallenge: async () => {
        throw new Error("not used");
      },
      verifyChallenge: async () => {
        throw new Error("not used");
      },
      refreshSession: async () => {
        throw new Error("not used");
      },
      authorizeStore: async () => ({
        userId: "77777777-7777-4777-8777-777777777777",
        sessionId: "88888888-8888-4888-8888-888888888888",
        deviceId: "33333333-3333-4333-8333-333333333333",
        storeId,
        storeName: "Magasin test",
        role: "MANAGER",
      }),
      logout: async () => undefined,
    };
  }

  it("returns an authorized snapshot with the requested history policy", async () => {
    const syncBootstrap: SyncBootstrapService = {
      bootstrap: async (store, query) => ({
        protocolVersion: 1,
        store: { id: store.storeId, name: store.storeName, role: store.role },
        snapshotRevision: "revision-1",
        cursor: "opaque-cursor",
        historyPolicy: { rawObservationDays: query.rawObservationDays },
        entities: {
          syncTestEntities: [],
          products: [],
          productIdentifiers: [],
          productAliases: [],
          needUnits: [],
          needMemberships: [],
          productSubstitutions: [],
          salesObservations: [],
          wasteObservations: [],
          commercialOperations: [],
          offers: [],
          marketSignals: [],
          executionInstructions: [],
          storeEvents: [],
          productDailyPerformance: [],
          departmentDailyPerformance: [],
          recommendations: [],
          decisions: [],
          actionExecutions: [],
        },
        serverTime: "2026-09-26T08:00:00.000Z",
      }),
    };
    const app = createAuthApp(fakeAuth(), undefined, undefined, syncBootstrap);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sync/bootstrap?rawObservationDays=30",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(bootstrapResponseSchema.parse(response.json())).toMatchObject({
      store: { id: storeId, name: "Magasin test" },
      historyPolicy: { rawObservationDays: 30 },
      cursor: "opaque-cursor",
    });
  });

  it("rejects an unsupported history window", async () => {
    const app = createAuthApp(fakeAuth(), undefined, undefined, {
      bootstrap: async () => {
        throw new Error("bootstrap must not run");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sync/bootstrap?rawObservationDays=366",
      headers: {
        authorization: "Bearer access-token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
