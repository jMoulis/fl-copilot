import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { illustrationGenerationFixture } from "../../../scripts/test-layout-illustration-generation";
it("requires private authorization for quotes and progress, returns disabled without spending and exposes no direct generation write", async () => {
  const f = await illustrationGenerationFixture(),
    scope = { storeId: f.scope.storeId, userId: f.scope.ownerId };
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
        role: "MANAGER",
        storeName: "Test",
        deviceId: randomUUID(),
        sessionId: randomUUID(),
      };
    }),
  };
  const database = {
    getDb: vi.fn(),
    checkHealth: async () => "connected" as const,
    close: async () => {},
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    auth,
    database,
  });
  try {
    const quote = `/api/v1/copilot/layout-illustrations/${f.preparation.id}/quote`,
      progress = `/api/v1/copilot/layout-illustration-generations/${randomUUID()}`,
      headers = { authorization: "Bearer valid", "x-store-id": scope.storeId };
    for (const url of [quote, progress]) {
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
      expect(
        (await app.inject({ method: "POST", url, headers, payload: {} }))
          .statusCode,
      ).toBe(404);
    }
    const disabled = await app.inject({ url: quote, headers });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ state: "DISABLED" });
    expect(disabled.headers["cache-control"]).toBe("private, no-store");
    expect(database.getDb).not.toHaveBeenCalled();
  } finally {
    await app.close();
    f.db.close();
  }
});
