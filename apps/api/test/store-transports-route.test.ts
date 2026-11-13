import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { ContextProviderCache } from "../src/context/provider-cache";
it("authorizes the exact store before lookup and refuses invalid coordinates/radii without fetching providers", async () => {
  const storeId = randomUUID(),
    getDb = vi.fn(async () => ({}) as never);
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, id) => {
      if (token !== "test" || id !== storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé.");
      return {
        storeId,
        userId: randomUUID(),
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeName: "Test",
        role: "MANAGER",
      };
    }),
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb,
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth,
  });
  const read = vi
    .spyOn(ContextProviderCache.prototype, "read")
    .mockResolvedValue({
      data: { total_count: 0, results: [] },
      retrievedAt: "2026-11-13T10:00:00.000Z",
      validUntil: "2026-11-14T10:00:00.000Z",
      failed: false,
    });
  const payload = {
    address: null,
    postalCode: "92600",
    point: { latitude: 48.9181, longitude: 2.2935 },
    radiusMetres: 800,
  };
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/store/transports/nearby",
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/store/transports/nearby",
          headers: { authorization: "Bearer test", "x-store-id": randomUUID() },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    const headers = { authorization: "Bearer test", "x-store-id": storeId };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/store/transports/nearby",
          headers,
          payload: { ...payload, radiusMetres: 9000 },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/transports/nearby",
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ storeId, lines: [] });
    expect(JSON.stringify(response.json())).not.toContain("apikey");
  } finally {
    read.mockRestore();
    await app.close();
  }
});
