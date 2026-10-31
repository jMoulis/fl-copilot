import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
it("passes the authenticated owner for a standalone email decision, including a spoofed payload owner", async () => {
  const ownerId = randomUUID(),
    storeId = randomUUID(),
    deviceId = randomUUID();
  const push = vi.fn(async () => ({
    results: [],
    serverTime: new Date().toISOString(),
  }));
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
        userId: ownerId,
        storeId,
        deviceId,
        sessionId: randomUUID(),
        storeName: "Test",
        role: "MANAGER",
      }),
    } as unknown as AuthService,
  });
  try {
    const body = {
      syncProtocolVersion: 1,
      appVersion: "test",
      storeId,
      deviceId,
      commands: [
        {
          commandId: randomUUID(),
          localSequence: 1,
          type: "EMAIL_INTAKE_DECIDE",
          entityType: "email_intake_decision",
          entityId: randomUUID(),
          createdAt: new Date().toISOString(),
          payload: { ownerId: randomUUID() },
        },
      ],
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: {
        authorization: "Bearer test",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(push).toHaveBeenCalledWith(body, expect.any(String), ownerId);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { "x-store-id": storeId, "x-sync-protocol-version": "1" },
      payload: body,
    });
    expect(denied.statusCode).toBe(401);
    expect(push).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
