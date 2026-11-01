import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
it("retires import classification for installed clients without calling any model, retaining manager authentication", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    getDb = vi.fn();
  let role = "MANAGER";
  const authorizeStore = vi.fn(async (token: string, id: string) => {
    if (token !== "valid" || id !== storeId)
      throw new AuthError(403, "FORBIDDEN", "Non autorisé.");
    return {
      storeId,
      userId: ownerId,
      deviceId: randomUUID(),
      sessionId: randomUUID(),
      storeName: "Test",
      role,
    };
  });
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb,
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth: { authorizeStore } as unknown as AuthService,
  });
  try {
    const send = (
      headers: Record<string, string> = {},
      payload: Record<string, unknown> = { labels: ["Poire"] },
    ) =>
      app.inject({
        method: "POST",
        url: "/api/v1/copilot/import-classification",
        headers,
        payload,
      });
    expect((await send()).statusCode).toBe(401);
    expect((await send({ authorization: "Bearer valid" })).statusCode).toBe(
      400,
    );
    const headers = { authorization: "Bearer valid", "x-store-id": storeId };
    role = "STAFF";
    expect((await send(headers)).statusCode).toBe(403);
    role = "MANAGER";
    expect(
      (await send(headers, { labels: ["Poire"], storeId: randomUUID() }))
        .statusCode,
    ).toBe(400);
    const retired = await send(headers);
    expect(retired.statusCode).toBe(410);
    expect(retired.json()).toMatchObject({
      code: "IMPORT_CLASSIFICATION_RETIRED",
      retryable: false,
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(authorizeStore).toHaveBeenCalledWith("valid", storeId);
  } finally {
    await app.close();
  }
});
