import { expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { serializeChatForClient } from "../src/copilot/conversation-store";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { randomUUID } from "node:crypto";
import { largeAnalyticalContext } from "../../../scripts/test-analytics-destination-fixtures";
import {
  copilotMessageSchema,
  packAnalyticsDestinations,
} from "@fl-copilot/domain";
vi.mock("../src/copilot/turn-service", async (original) => ({
  ...(await original<typeof import("../src/copilot/turn-service")>()),
  runCopilotTurn: vi.fn(),
}));
it.each([undefined, "1", "2", "1,2"])(
  "negotiates only the supported compact format and projects cached replies for installed clients (%s)",
  async (version) => {
    const f = chatFixture(randomUUID),
      input = {
        replyId: randomUUID(),
        conversationId: f.conversation.id,
        userMessageId: f.message.id,
      };
    const message = copilotMessageSchema.parse({
      ...f.message,
      id: input.replyId,
      role: "ASSISTANT",
      replyToMessageId: input.userMessageId,
      answerSources: [
        {
          label: "Ventes",
          value: "12.30",
          sourceId: "canonical",
          sourceType: "KPI",
        },
      ],
      analyticsDestinations: packAnalyticsDestinations([
        largeAnalyticalContext(),
      ]),
    });
    vi.mocked(runCopilotTurn).mockResolvedValue({
      message,
      alreadyApplied: true,
    });
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      auth: {
        authorizeStore: async () => ({
          userId: f.ownerId,
          storeId: f.storeId,
          deviceId: randomUUID(),
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER",
        }),
      } as unknown as AuthService,
      database: {
        getDb: async () => ({}) as Db,
        checkHealth: async () => "connected",
        close: async () => {},
      },
      copilotContext: vi.fn(),
    });
    try {
      for (const stream of [false, true]) {
        const result = await app.inject({
          method: "POST",
          url: "/api/v1/copilot/turn",
          headers: {
            authorization: "Bearer test",
            "x-store-id": f.storeId,
            ...(version ? { "x-copilot-analytics-destinations": version } : {}),
            ...(stream ? { accept: "application/x-ndjson" } : {}),
          },
          payload: input,
        });
        expect(result.statusCode).toBe(200);
        const body = stream
          ? result.body
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
              .find((e) => e.type === "result").result
          : result.json();
        expect(body.alreadyApplied).toBe(true);
        expect(body.message.analyticsDestinations).toEqual(
          version === "1" || version === "2"
            ? message.analyticsDestinations
            : undefined,
        );
        expect(body.message.answerSources).toEqual(
          version === "2" ? message.answerSources : undefined,
        );
        expect(body.message.text).toBe(message.text);
      }
    } finally {
      await app.close();
    }
  },
);
it("shares the strict projection used by history, bootstrap and pull without changing canonical storage", () => {
  const f = chatFixture(randomUUID);
  const message = copilotMessageSchema.parse({
    ...f.message,
    role: "ASSISTANT",
    analyticsDestinations: packAnalyticsDestinations([
      largeAnalyticalContext(),
    ]),
  });
  const row = { ...message, _id: message.id };
  const projected = serializeChatForClient("copilot_message", row, true);
  expect(projected).not.toHaveProperty("analyticsDestinations");
  expect(serializeChatForClient("copilot_message", row, true, true)).toEqual(
    message,
  );
  expect(row.analyticsDestinations).toEqual(message.analyticsDestinations);
});
