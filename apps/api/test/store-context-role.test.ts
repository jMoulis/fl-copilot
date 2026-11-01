import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
it.each(["MANAGER", "ASSISTANT"])(
  "requires manager authority for settings/merchandising even with a negotiated capability (%s)",
  async (role) => {
    const settings = storeContextFixture(),
      deviceId = randomUUID();
    const push = vi.fn(async () => ({
      results: [],
      serverTime: new Date().toISOString(),
    }));
    const auth: AuthService = {
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      authorizeStore: vi.fn(async () => ({
        userId: randomUUID(),
        storeId: settings.storeId,
        storeName: "Test",
        deviceId,
        sessionId: randomUUID(),
        role,
      })),
    };
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      database: {
        checkHealth: async () => "connected",
        getDb: vi.fn(),
        close: async () => {},
      },
      auth,
      syncPush: { push },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: {
          authorization: "Bearer test",
          "x-store-id": settings.storeId,
          "x-sync-protocol-version": "1",
        },
        payload: {
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId,
          storeId: settings.storeId,
          storeMerchandising: true,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: "STORE_CONTEXT_SETTINGS_UPSERT",
              entityType: "store_context_settings",
              entityId: settings.id,
              expectedRemoteVersion: null,
              createdAt: settings.createdAt,
              payload: settings,
            },
          ],
        },
      });
      expect(response.statusCode).toBe(role === "MANAGER" ? 200 : 403);
      expect(push).toHaveBeenCalledTimes(role === "MANAGER" ? 1 : 0);
    } finally {
      await app.close();
    }
  },
);
