import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  healthResponseSchema,
} from "@fl-copilot/sync-contracts";
import { buildApp } from "../src/app.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService, DatabaseStatus } from "../src/database/types.js";
import type { AuthService } from "../src/auth/service.js";
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
function createApp(status: DatabaseStatus = "connected") {
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: createDatabase(status),
  });
  apps.push(app);
  return app;
}
function createAuthApp(auth: AuthService) {
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: createDatabase(),
    auth,
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
  it("requires a secure email delivery adapter in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017",
        AUTH_TOKEN_SECRET: "t".repeat(32),
        AUTH_CODE_PEPPER: "p".repeat(32),
      }),
    ).toThrow("AUTH_EMAIL_WEBHOOK_URL");
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
