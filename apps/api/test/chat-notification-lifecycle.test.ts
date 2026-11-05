import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import { runCopilotTurn } from "../src/copilot/turn-service";
import {
  notifyChatCompletion,
  registeredChatPush,
} from "../src/notifications/chat-completion";
import type { AuthService } from "../src/auth/service";
import type { Db } from "mongodb";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
vi.mock("../src/copilot/turn-service", async (original) => ({
  ...(await original<object>()),
  runCopilotTurn: vi.fn(),
}));
vi.mock("../src/notifications/chat-completion", async (original) => ({
  ...(await original<object>()),
  registeredChatPush: vi.fn(async () => "registered-token"),
  notifyChatCompletion: vi.fn(async () => {}),
}));
afterEach(() => {
  vi.mocked(runCopilotTurn).mockReset();
  vi.mocked(notifyChatCompletion).mockReset();
  vi.mocked(registeredChatPush).mockResolvedValue("registered-token");
});
function setup() {
  const f = chatFixture(randomUUID),
    tasks: Promise<void>[] = [];
  const result = {
    message: {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      attachments: [],
      replyToMessageId: f.message.id,
    },
    alreadyApplied: false,
  };
  const auth = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async () => ({
      userId: f.ownerId,
      storeId: f.storeId,
      deviceId: f.deviceId,
      sessionId: randomUUID(),
      storeName: "Test",
      role: "MANAGER",
    })),
  } satisfies AuthService;
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb: async () => ({}) as Db,
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth,
    copilotContext: vi.fn(),
    waitUntil: (p) => {
      tasks.push(p);
    },
  });
  let markTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => {
    markTransportClosed = resolve;
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.raw.once("close", markTransportClosed);
  });
  const payload = {
    conversationId: f.conversation.id,
    replyId: result.message.id,
    userMessageId: f.message.id,
  };
  const headers = {
    authorization: "Bearer test-only",
    "x-store-id": f.storeId,
    "x-commercial-source-version": "2",
    accept: "application/x-ndjson",
    "x-copilot-activity": "1",
    "content-type": "application/json",
    "x-copilot-background-completion": "1",
  };
  return { f, app, result, payload, headers, tasks, transportClosed };
}
it.each([true, false])(
  "disconnect preserves only an opted-in registered generation: %s",
  async (optedIn) => {
    const x = setup();
    let signal!: AbortSignal, finish!: () => void;
    vi.mocked(runCopilotTurn).mockImplementation(async (deps, _, s) => {
      signal = s!;
      deps.onActivity?.({ id: "test", stage: "PREPARING", status: "RUNNING" });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return x.result;
    });
    const address = await x.app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    try {
      const response = await fetch(address + "/api/v1/copilot/turn", {
        method: "POST",
        headers: {
          ...x.headers,
          "x-copilot-background-completion": optedIn ? "1" : "0",
        },
        body: JSON.stringify(x.payload),
        signal: controller.signal,
      });
      await response.body!.getReader().read();
      controller.abort();
      await x.transportClosed;
      expect(signal.aborted).toBe(!optedIn);
      finish();
      await Promise.all(x.tasks);
      expect(notifyChatCompletion).toHaveBeenCalledTimes(optedIn ? 1 : 0);
    } finally {
      finish?.();
      x.app.server.closeAllConnections();
      await x.app.close();
    }
  },
);
it.each([true, false])(
  "does not delay a committed stream for push delivery; cached result=%s",
  async (cached) => {
    const x = setup();
    let release!: () => void;
    vi.mocked(runCopilotTurn).mockResolvedValue({
      ...x.result,
      alreadyApplied: cached,
    });
    vi.mocked(notifyChatCompletion).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    try {
      const response = await x.app.inject({
        method: "POST",
        url: "/api/v1/copilot/turn",
        headers: x.headers,
        payload: x.payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"type":"result"');
      expect(notifyChatCompletion).toHaveBeenCalledTimes(cached ? 0 : 1);
      release?.();
      await Promise.all(x.tasks);
    } finally {
      release?.();
      x.app.server.closeAllConnections();
      await x.app.close();
    }
  },
);
it("notification failure cannot turn a committed answer into a stream error", async () => {
  const x = setup();
  vi.mocked(runCopilotTurn).mockResolvedValue(x.result);
  vi.mocked(notifyChatCompletion).mockRejectedValue(
    Error("provider-private-token"),
  );
  try {
    const response = await x.app.inject({
      method: "POST",
      url: "/api/v1/copilot/turn",
      headers: x.headers,
      payload: x.payload,
    });
    await Promise.all(x.tasks);
    expect(response.body).toContain('"type":"result"');
    expect(response.body).not.toContain('"type":"error"');
    expect(response.body).not.toContain("provider-private-token");
  } finally {
    x.app.server.closeAllConnections();
    await x.app.close();
  }
});
it("an unregistered old client retains normal disconnect semantics and no push", async () => {
  const x = setup();
  vi.mocked(registeredChatPush).mockResolvedValue(undefined);
  vi.mocked(runCopilotTurn).mockResolvedValue(x.result);
  try {
    await x.app.inject({
      method: "POST",
      url: "/api/v1/copilot/turn",
      headers: x.headers,
      payload: x.payload,
    });
    expect(x.tasks).toHaveLength(0);
    expect(notifyChatCompletion).not.toHaveBeenCalled();
  } finally {
    x.app.server.closeAllConnections();
    await x.app.close();
  }
});
