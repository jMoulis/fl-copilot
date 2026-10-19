import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { runCopilotTurn, CopilotTurnError } from "../src/copilot/turn-service";
import { captureApiError } from "../src/observability";
vi.mock("../src/copilot/turn-service", async (original) => ({
  ...(await original<typeof import("../src/copilot/turn-service")>()),
  runCopilotTurn: vi.fn(),
}));
vi.mock("../src/observability", () => ({
  captureApiError: vi.fn(),
  logRemoteEvent: vi.fn(),
}));
it.each([false, true])(
  "reports swallowed generation failures for both JSON and streamed chat (%s)",
  async (streaming) => {
    vi.clearAllMocks();
    const storeId = randomUUID(),
      ownerId = randomUUID();
    const input = {
      replyId: randomUUID(),
      userMessageId: randomUUID(),
      conversationId: randomUUID(),
    };
    const privateText = "private question, financial data and provider secret";
    let bug: Error | undefined;
    const message = {
      id: input.replyId,
      storeId,
      ownerId,
      conversationId: input.conversationId,
      role: "ASSISTANT" as const,
      text: "Je n’ai pas pu terminer cette analyse.",
      attachments: [],
      replyToMessageId: input.userMessageId,
      supersedesMessageId: null,
      version: 1 as const,
      createdAt: new Date().toISOString(),
    };
    const failure = {
      requestId: randomUUID(),
      kind: "GROUNDING" as const,
      code: "UNSUPPORTED_NUMBER" as const,
      retryable: false,
      durationMs: 73000,
    };
    vi.mocked(runCopilotTurn).mockImplementation(async (deps) => {
      deps.onProgress?.("Préparation de la réponse…");
      if (bug) throw bug;
      deps.onGenerationFailure?.(failure);
      return { message, alreadyApplied: false };
    });
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      database: {
        getDb: async () => ({}) as Db,
        checkHealth: async () => "connected",
        close: async () => {},
      },
      copilotContext: vi.fn(),
      auth: {
        authorizeStore: vi.fn(async () => ({
          userId: ownerId,
          storeId,
          deviceId: randomUUID(),
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER",
        })),
      } as unknown as AuthService,
    });
    const serverLog = vi.spyOn(app.log, "error");
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/copilot/turn",
        headers: {
          authorization: "Bearer valid",
          "x-store-id": storeId,
          ...(streaming ? { accept: "application/x-ndjson" } : {}),
        },
        payload: input,
      });
    try {
      const result = await send();
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain(message.text);
      expect(result.body).not.toContain(failure.code);
      expect(serverLog).toHaveBeenCalledWith(
        expect.objectContaining(failure),
        "Copilot generation fallback",
      );
      expect(captureApiError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Copilot fallback: UNSUPPORTED_NUMBER",
        }),
        expect.objectContaining({ code: failure.code, method: "POST" }),
      );
      expect(JSON.stringify(serverLog.mock.calls)).not.toContain(storeId);
      if (streaming) {
        vi.clearAllMocks();
        bug = new Error(privateText);
        const failed = await send();
        expect(failed.body).toContain('"type":"error"');
        expect(failed.body).not.toContain(privateText);
        expect(captureApiError).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Copilot stream failed" }),
          expect.objectContaining({ code: "COPILOT_STREAM_FAILED" }),
        );
        expect(JSON.stringify(serverLog.mock.calls)).not.toContain(privateText);
        vi.clearAllMocks();
        bug = new CopilotTurnError("CANCELLED");
        await send();
        expect(captureApiError).not.toHaveBeenCalled();
      }
    } finally {
      serverLog.mockRestore();
      await app.close();
    }
  },
);
