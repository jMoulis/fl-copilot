import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ApiClient } from "../../../packages/api-client/src/index";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { AuthError, type AuthService } from "../src/auth/service";
import { runCopilotTurn, CopilotTurnError } from "../src/copilot/turn-service";
vi.mock("../src/copilot/turn-service", async (original) => ({
  ...(await original<typeof import("../src/copilot/turn-service")>()),
  runCopilotTurn: vi.fn(),
}));
it("streams scoped progress over HTTP before the committed reply and preserves ordinary auth failures", async () => {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    input = {
      replyId: randomUUID(),
      userMessageId: randomUUID(),
      conversationId: randomUUID(),
    };
  const message = {
    id: input.replyId,
    storeId,
    ownerId,
    conversationId: input.conversationId,
    role: "ASSISTANT" as const,
    text: "Voici le bilan final.",
    attachments: [],
    replyToMessageId: input.userMessageId,
    supersedesMessageId: null,
    version: 1 as const,
    createdAt: new Date().toISOString(),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(runCopilotTurn).mockImplementation(async (dependencies) => {
    dependencies.onActivity?.({
      id: "preparing",
      stage: "PREPARING",
      status: "RUNNING",
    });
    dependencies.onProgress?.("Voici le début de la réponse…");
    dependencies.onActivity?.({
      id: "preparing",
      stage: "PREPARING",
      status: "DONE",
    });
    await gate;
    return { message, alreadyApplied: false };
  });
  const auth = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: async (token: string) => {
      if (token !== "valid")
        throw new AuthError(401, "AUTH_REQUIRED", "Connectez-vous.");
      return {
        userId: ownerId,
        storeId,
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeName: "Test",
        role: "MANAGER",
      };
    },
  } as AuthService;
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    auth,
    database: {
      getDb: async () => ({}) as Db,
      checkHealth: async () => "connected",
      close: async () => {},
    },
    copilotContext: vi.fn(),
  });
  let finishCancelled: (() => void) | undefined;
  let result: ReturnType<ApiClient["copilotTurn"]> | undefined;
  try {
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const progress = vi.fn(),
      activity = vi.fn();
    result = new ApiClient(url).copilotTurn(
      "valid",
      storeId,
      ownerId,
      input,
      undefined,
      { onProgress: progress, onActivity: activity },
    );
    await vi.waitFor(() =>
      expect(progress).toHaveBeenCalledWith("Voici le début de la réponse…"),
    );
    expect(activity).toHaveBeenCalledWith({
      id: "preparing",
      stage: "PREPARING",
      status: "RUNNING",
    });
    expect(activity).toHaveBeenCalledWith({
      id: "preparing",
      stage: "PREPARING",
      status: "DONE",
    });
    release();
    expect((await result).message).toEqual(message);
    await new ApiClient(url).copilotTurn(
      "valid",
      storeId,
      ownerId,
      input,
      undefined,
      { onProgress: vi.fn() },
    );
    expect(
      vi.mocked(runCopilotTurn).mock.calls.at(-1)![0].onActivity,
    ).toBeUndefined();
    const denied = await fetch(`${url}/api/v1/copilot/turn`, {
      method: "POST",
      headers: {
        authorization: "Bearer invalid",
        "x-store-id": storeId,
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify(input),
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("content-type")).toContain("application/json");
    let entered!: () => void, cancelled: AbortSignal | undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(runCopilotTurn).mockImplementation(
      async (_dependencies, _input, signal) => {
        cancelled = signal;
        entered();
        await new Promise<void>((resolve) => {
          finishCancelled = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new CopilotTurnError("CANCELLED");
      },
    );
    const abort = new AbortController();
    const interrupted = fetch(`${url}/api/v1/copilot/turn`, {
      method: "POST",
      signal: abort.signal,
      headers: {
        authorization: "Bearer valid",
        "x-store-id": storeId,
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify(input),
    });
    await ready;
    abort.abort();
    await expect(interrupted).rejects.toThrow();
    await vi.waitFor(() => expect(cancelled?.aborted).toBe(true));
  } finally {
    release();
    finishCancelled?.();
    await result?.catch(() => undefined);
    app.server.closeAllConnections();
    await app.close();
  }
});
