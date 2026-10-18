import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { commercialReviewFixture } from "../../../scripts/test-commercial-processing-fixtures";
it("authorizes reads twice and binds resume decisions to the current manager/device with a strict body", async () => {
  const review = commercialReviewFixture(),
    storeId = randomUUID(),
    userId = randomUUID(),
    deviceId = randomUUID();
  let role = "MANAGER",
    calls = 0,
    revokeAt = Infinity;
  const authorizeStore = vi.fn(
    async (token: string, store: string, device?: string) => {
      if (
        token !== "valid" ||
        store !== storeId ||
        (device && device !== deviceId) ||
        ++calls >= revokeAt
      )
        throw new AuthError(403, "STORE_FORBIDDEN", "Magasin non autorisé.");
      return {
        userId,
        deviceId,
        sessionId: randomUUID(),
        storeId,
        storeName: "Test",
        role,
      };
    },
  );
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore,
  };
  const request = vi.fn(
    async (
      _s: string,
      id: string,
      input: { operationId: string; basisHash: string },
      actor: { userId: string; deviceId: string },
      authorize: () => Promise<void>,
    ) => {
      await authorize();
      expect(actor).toEqual({ userId, deviceId });
      return {
        operationId: input.operationId,
        sourceDocumentId: id,
        status: "REQUESTED" as const,
      };
    },
  );
  const read = vi.fn(async () => review),
    recovery = {
      review: read,
      request,
      pendingDispatches: vi.fn(),
      work: vi.fn(),
    };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      checkHealth: async () => "connected",
      getDb: vi.fn(),
      close: async () => {},
    },
    auth,
    commercialRecovery: recovery,
  });
  const url = `/api/v1/commercial/${review.sourceDocumentId}`,
    headers = { authorization: "Bearer valid", "x-store-id": storeId },
    payload = { operationId: randomUUID(), basisHash: review.basisHash };
  try {
    expect((await app.inject({ url: `${url}/processing` })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          url: `${url}/processing`,
          headers: { ...headers, "x-store-id": randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(
      (await app.inject({ url: `${url}/processing`, headers })).json(),
    ).toEqual(review);
    for (const extra of [{ stage: "AI" }, { userId }, { force: true }])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${url}/resume`,
            headers,
            payload: { ...payload, ...extra },
          })
        ).statusCode,
      ).toBe(400);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/resume`,
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    role = "VIEWER";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/resume`,
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    role = "MANAGER";
    revokeAt = calls + 2;
    expect(
      (await app.inject({ url: `${url}/processing`, headers })).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
