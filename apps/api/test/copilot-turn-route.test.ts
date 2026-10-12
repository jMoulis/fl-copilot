import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
it("authorizes before context/database access and remains unavailable without trusted context wiring", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    getDb = vi.fn();
  const auth = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token: string, requestedStore: string) => {
      if (token !== "valid" || requestedStore !== storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Magasin non autorisé.");
      return {
        userId: ownerId,
        storeId,
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeName: "Test",
        role: "MANAGER",
      };
    }),
  } as AuthService;
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb,
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth,
  });
  const payload = {
    replyId: randomUUID(),
    conversationId: randomUUID(),
    userMessageId: randomUUID(),
  };
  try {
    const send = (headers: Record<string, string>, body = payload) =>
      app.inject({
        method: "POST",
        url: "/api/v1/copilot/turn",
        headers,
        payload: body,
      });
    expect((await send({})).statusCode).toBe(401);
    expect((await send({ authorization: "Bearer valid" })).statusCode).toBe(
      400,
    );
    expect(
      (
        await send({
          authorization: "Bearer valid",
          "x-store-id": randomUUID(),
        })
      ).statusCode,
    ).toBe(403);
    const headers = { authorization: "Bearer valid", "x-store-id": storeId };
    const response = await send(headers);
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("COPILOT_NOT_READY");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/copilot/turn",
          headers,
          payload: { ...payload, ownerId },
        })
      ).statusCode,
    ).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
