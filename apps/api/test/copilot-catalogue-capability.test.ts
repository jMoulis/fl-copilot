import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { createCopilotAiProvider } from "../src/copilot/ai-provider";
import { readCataloguePreview } from "../src/copilot/catalogue-preview-tool";
vi.mock("../src/copilot/catalogue-preview-tool", () => ({
  readCataloguePreview: vi.fn(),
}));
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
it.each([undefined, "1", "2", "3", "2,1"])(
  "enables only the catalogue maintenance semantics actually advertised by the client (%s)",
  async (version) => {
    const storeId = randomUUID(),
      ownerId = randomUUID();
    const payload = {
      replyId: randomUUID(),
      conversationId: randomUUID(),
      userMessageId: randomUUID(),
    };
    const message = {
      id: payload.replyId,
      storeId,
      ownerId,
      conversationId: payload.conversationId,
      role: "ASSISTANT" as const,
      text: "Test",
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
    const auth = {
      authorizeStore: vi.fn(async () => ({
        userId: ownerId,
        storeId,
        deviceId: randomUUID(),
        sessionId: randomUUID(),
        storeName: "Test",
        role: "MANAGER",
      })),
    } as unknown as AuthService;
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth,
      database: {
        getDb: async () => ({}) as Db,
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
          ...(version ? { "x-copilot-catalogue-proposals": version } : {}),
        },
        payload,
      });
      expect(result.statusCode).toBe(200);
      const reads = vi.mocked(createCopilotAiProvider).mock.calls[0]![2]!;
      if (version === "1" || version === "2") {
        expect(reads.cataloguePreview).toBeTypeOf("function");
        vi.mocked(readCataloguePreview).mockClear();
        const input = {
          action: "INSPECT" as const,
          productId: randomUUID(),
          patch: {},
        };
        await reads.cataloguePreview!(input);
        expect(readCataloguePreview).toHaveBeenCalledWith(
          expect.anything(),
          storeId,
          input,
          {
            allowInactiveMaintenance: version === "2",
          },
        );
      } else {
        expect(reads.cataloguePreview).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  },
);
