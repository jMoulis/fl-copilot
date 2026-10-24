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
  const m = await original<typeof import("../src/copilot/ai-provider")>();
  return { ...m, createCopilotAiProvider: vi.fn(m.createCopilotAiProvider) };
});
it.each([undefined, "1", "2", "1,1"])(
  "exposes visual-action preparation only for its negotiated capability (%s)",
  async (version) => {
    const storeId = randomUUID(),
      ownerId = randomUUID(),
      payload = {
        replyId: randomUUID(),
        conversationId: randomUUID(),
        userMessageId: randomUUID(),
      },
      message = {
        id: payload.replyId,
        storeId,
        ownerId,
        conversationId: payload.conversationId,
        role: "ASSISTANT" as const,
        text: "Proposition",
        attachments: [],
        replyToMessageId: payload.userMessageId,
        supersedesMessageId: null,
        version: 1 as const,
        createdAt: new Date().toISOString(),
      };
    vi.mocked(runCopilotTurn).mockResolvedValue({
      message,
      alreadyApplied: false,
    });
    const authorizeStore = vi.fn(async () => ({
        userId: ownerId,
        storeId,
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeName: "Fixture",
        role: "MANAGER",
      })),
      collection = vi.fn(() => {
        throw Error("UNEXPECTED_QUERY");
      });
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth: { authorizeStore } as unknown as AuthService,
      database: {
        getDb: async () => ({ collection }) as unknown as Db,
        checkHealth: async () => "connected",
        close: async () => {},
      },
      copilotContext: vi.fn(),
    });
    try {
      vi.mocked(createCopilotAiProvider).mockClear();
      const result = await app.inject({
        method: "POST",
        url: "/api/v1/copilot/turn",
        headers: {
          authorization: "Bearer test",
          "x-store-id": storeId,
          ...(version ? { "x-copilot-visual-actions": version } : {}),
        },
        payload,
      });
      expect(result.statusCode).toBe(200);
      const reads = vi.mocked(createCopilotAiProvider).mock.calls[0]![2]!;
      if (version === "1") {
        expect(reads.visualAction).toBeTypeOf("function");
        authorizeStore.mockRejectedValueOnce(Error("FIXTURE_ACCESS_REVOKED"));
        await expect(
          reads.visualAction!({
            action: "REMOVE_PRODUCT",
            productId: randomUUID(),
            visualIdentityId: null,
          }),
        ).rejects.toThrow("FIXTURE_ACCESS_REVOKED");
      } else expect(reads.visualAction).toBeUndefined();
      expect(collection).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
