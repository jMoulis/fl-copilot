import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { layoutFixture } from "../../../scripts/test-store-layout-fixtures";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
it.each(["MANAGER", "VIEWER"])(
  "uses the authenticated manager identity for store-plan writes (%s)",
  async (role) => {
    const p = layoutFixture(),
      deviceId = randomUUID(),
      push = vi.fn(async () => ({ results: [], serverTime: p.updatedAt }));
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      database: {
        getDb: async () => {
          throw Error("NO_DATABASE_CALL");
        },
        checkHealth: async () => "connected",
        close: async () => {},
      },
      syncPush: { push },
      auth: {
        authorizeStore: async () => ({
          userId: p.updatedBy,
          storeId: p.storeId,
          deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role,
        }),
      } as unknown as AuthService,
    });
    try {
      const body = {
        syncProtocolVersion: 1,
        storeId: p.storeId,
        deviceId,
        appVersion: "test",
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "STORE_LAYOUT_UPSERT",
            entityType: "store_layout",
            entityId: p.id,
            expectedRemoteVersion: null,
            createdAt: p.updatedAt,
            payload: p,
          },
        ],
      };
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: {
          authorization: "Bearer token",
          "x-store-id": p.storeId,
          "x-sync-protocol-version": "1",
        },
        payload: body,
      });
      expect(r.statusCode).toBe(role === "MANAGER" ? 200 : 403);
      if (role === "MANAGER")
        expect(push).toHaveBeenCalledWith(
          body,
          expect.any(String),
          p.updatedBy,
        );
      else expect(push).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
