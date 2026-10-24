import { layoutFixture } from "../../../scripts/test-store-layout-fixtures";
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
it.each([undefined, "1", "2", "3", "4", "5", "6", "7", "6,5"])(
  "enables physical-plan comparisons only with the advertised store-conflict version (%s)",
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
    const plan = layoutFixture(storeId, ownerId),
      findOne = vi.fn(async () => ({ _id: storeId, ...plan }));
    const collection = vi.fn((name: string) => {
      if (name !== "storeLayouts") throw Error("UNEXPECTED_COLLECTION");
      return { findOne };
    });
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth,
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
          ...(version ? { "x-copilot-store-conflicts": version } : {}),
        },
        payload,
      });
      expect(result.statusCode).toBe(200);
      const reads = vi.mocked(createCopilotAiProvider).mock.calls[0]![2]!;
      if (version && ["1", "2", "3", "4", "5", "6"].includes(version)) {
        expect(reads.storeConflictVersion).toBe(Number(version));
        expect(reads.storeConflict).toBeTypeOf("function");
        if (version === "6") {
          const result = await reads.storeConflict!({
            kind: "STORE_LAYOUT",
            entityId: null,
          });
          expect(result.basis.layout?.revisionId).toBe(plan.revisionId);
          expect(findOne).toHaveBeenCalledWith(
            { _id: storeId, storeId },
            { maxTimeMS: 2000 },
          );
          expect(collection).toHaveBeenCalledTimes(1);
        } else {
          await expect(
            reads.storeConflict!({ kind: "STORE_LAYOUT", entityId: null }),
          ).rejects.toThrow();
          expect(collection).not.toHaveBeenCalled();
        }
      } else {
        expect(reads.storeConflictVersion).toBeUndefined();
        expect(reads.storeConflict).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  },
);
