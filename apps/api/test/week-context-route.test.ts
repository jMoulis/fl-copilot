import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { weeklyContextFixture } from "../../../scripts/test-weekly-context-fixtures";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
it("requires store authorization before any provider request and validates week boundaries", async () => {
  const settings = storeContextFixture(),
    read = vi.fn(async () => weeklyContextFixture(settings));
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, storeId) => {
      if (token !== "valid" || storeId !== settings.storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Magasin non autorisé.");
      return {
        userId: randomUUID(),
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeId,
        storeName: "Test",
        role: "MANAGER",
      };
    }),
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      checkHealth: async () => "connected",
      getDb: vi.fn(),
      close: async () => {},
    },
    auth,
    weekContext: { read },
  });
  try {
    expect(
      (await app.inject({ url: "/api/v1/store/context?weekStart=2026-10-05" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/v1/store/context?weekStart=2026-10-05",
          headers: {
            authorization: "Bearer valid",
            "x-store-id": randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(403);
    const headers = {
      authorization: "Bearer valid",
      "x-store-id": settings.storeId,
    };
    for (const date of ["2026-10-06", "2026-02-30"]) {
      expect(
        (
          await app.inject({
            url: `/api/v1/store/context?weekStart=${date}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
    const response = await app.inject({
      url: "/api/v1/store/context?weekStart=2026-10-05",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().storeId).toBe(settings.storeId);
    expect(read).toHaveBeenCalledWith(settings.storeId, "2026-10-05");
  } finally {
    await app.close();
  }
});
