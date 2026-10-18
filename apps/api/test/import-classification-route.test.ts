import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
it("authenticates current manager scope before/after the bounded read-only model adapter and hides provider errors", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    getDb = vi.fn(),
    classify = vi.fn(async () => ({ model: "test", suggestions: [] }));
  let role = "MANAGER",
    revoked = false;
  const authorizeStore = vi.fn(async (token: string, id: string) => {
    if (token !== "valid" || id !== storeId || revoked)
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
    importClassifier: classify,
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
    expect(classify).not.toHaveBeenCalled();
    role = "MANAGER";
    expect(
      (await send(headers, { labels: ["Poire"], storeId: randomUUID() }))
        .statusCode,
    ).toBe(400);
    expect((await send(headers)).statusCode).toBe(200);
    expect(classify).toHaveBeenCalledOnce();
    expect(getDb).not.toHaveBeenCalled();
    classify.mockImplementationOnce(async () => {
      revoked = true;
      return { model: "test", suggestions: [] };
    });
    expect((await send(headers)).statusCode).toBe(503);
    revoked = false;
    classify.mockRejectedValueOnce(Error("provider credential private"));
    const error = await send(headers);
    expect(error.statusCode).toBe(503);
    expect(error.body).not.toContain("private");
  } finally {
    await app.close();
  }
});
