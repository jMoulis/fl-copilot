import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { createCopilotAiProvider } from "../src/copilot/ai-provider";
vi.mock("../src/copilot/turn-service", async (original) => ({
  ...(await original<typeof import("../src/copilot/turn-service")>()),
  runCopilotTurn: vi.fn(),
}));
vi.mock("../src/copilot/ai-provider", async (original) => {
  const module = await original<typeof import("../src/copilot/ai-provider")>();
  return {
    ...module,
    createCopilotAiProvider: vi.fn(module.createCopilotAiProvider),
  };
});
it.each([
  { choice: undefined, source: undefined, expected: undefined },
  { choice: "1", source: undefined, expected: 1 },
  { choice: "1", source: "2", expected: 1 },
  { choice: "2", source: undefined, expected: 1 },
  { choice: "2", source: "2", expected: 2 },
  { choice: "3", source: "2", expected: undefined },
  { choice: "2,1", source: "2", expected: undefined },
])(
  "negotiates original-backed offers only with both native capabilities ($choice / $source)",
  async ({ choice, source, expected }) => {
    const storeId = randomUUID(),
      ownerId = randomUUID(),
      input = {
        replyId: randomUUID(),
        conversationId: randomUUID(),
        userMessageId: randomUUID(),
      };
    const message = {
      id: input.replyId,
      storeId,
      ownerId,
      conversationId: input.conversationId,
      role: "ASSISTANT" as const,
      text: "Test",
      attachments: [],
      replyToMessageId: input.userMessageId,
      supersedesMessageId: null,
      version: 1 as const,
      createdAt: new Date().toISOString(),
    };
    vi.mocked(runCopilotTurn).mockResolvedValue({
      message,
      alreadyApplied: false,
    });
    vi.mocked(createCopilotAiProvider).mockClear();
    const auth = {
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      authorizeStore: async () => ({
        userId: ownerId,
        storeId,
        storeName: "Fixture",
        role: "MANAGER",
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      }),
    } satisfies AuthService;
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth,
      copilotContext: vi.fn(),
      database: {
        getDb: async () =>
          ({
            collection: () => ({ findOne: async () => null }),
          }) as unknown as Db,
        checkHealth: async () => "connected",
        close: async () => {},
      },
    });
    try {
      const result = await app.inject({
        method: "POST",
        url: "/api/v1/copilot/turn",
        headers: {
          authorization: "Bearer test",
          "x-store-id": storeId,
          ...(choice ? { "x-copilot-choice-create": choice } : {}),
          ...(source ? { "x-commercial-source-version": source } : {}),
        },
        payload: input,
      });
      expect(result.statusCode).toBe(200);
      const reads = vi.mocked(createCopilotAiProvider).mock.calls[0]![2]!;
      expect(reads.choiceCreateVersion).toBe(expected);
      if (expected) expect(reads.choiceCreate).toBeTypeOf("function");
      else expect(reads.choiceCreate).toBeUndefined();
    } finally {
      await app.close();
    }
  },
);
