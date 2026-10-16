import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { replyId: id(1), conversationId: id(2), userMessageId: id(3) };
const message = {
  id: input.replyId,
  storeId: id(4),
  ownerId: id(5),
  conversationId: input.conversationId,
  role: "ASSISTANT",
  text: "Réponse de test",
  attachments: [],
  replyToMessageId: input.userMessageId,
  supersedesMessageId: null,
  version: 1,
  createdAt: "2026-10-12T12:00:00.000Z",
};
afterEach(() => vi.unstubAllGlobals());
it("sends only IDs with authenticated store headers and validates reply scope", async () => {
  const transport = vi.fn(
    async () =>
      new Response(JSON.stringify({ message, alreadyApplied: false }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", transport);
  const api = new ApiClient("https://test.invalid");
  expect(
    (await api.copilotTurn("test-token", id(4), id(5), input)).message,
  ).toEqual(message);
  expect(transport).toHaveBeenCalledWith(
    "https://test.invalid/api/v1/copilot/turn",
    expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-store-id": id(4),
      },
      body: JSON.stringify(input),
    }),
  );
  for (const changed of [
    { ownerId: id(6) },
    { storeId: id(6) },
    { id: id(6) },
    { replyToMessageId: id(6) },
    { role: "USER" },
  ]) {
    transport.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            message: { ...message, ...changed },
            alreadyApplied: true,
          }),
          { status: 200 },
        ),
    );
    await expect(
      api.copilotTurn("test-token", id(4), id(5), input),
    ).rejects.toBeInstanceOf(ApiClientError);
  }
});
it("preserves safe retryable pending errors without inventing an assistant reply", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "COPILOT_TURN_PENDING",
            messageFr: "Une réponse est en préparation.",
            retryable: true,
          }),
          { status: 409 },
        ),
    ),
  );
  await expect(
    new ApiClient("https://test.invalid").copilotTurn(
      "test",
      id(4),
      id(5),
      input,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: { code: "COPILOT_TURN_PENDING", retryable: true },
  });
});

it("forwards cancellation to the turn transport without changing its stable IDs", async () => {
  const abort = new AbortController();
  const transport = vi.fn(
    async (_url: unknown, init: RequestInit | undefined) => {
      expect(init?.signal).toBe(abort.signal);
      expect(init?.body).toBe(JSON.stringify(input));
      abort.abort();
      throw new Error("REQUEST_ABORTED");
    },
  );
  vi.stubGlobal("fetch", transport);
  await expect(
    new ApiClient("https://test.invalid").copilotTurn(
      "test",
      id(4),
      id(5),
      input,
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("receives actual chunked UTF-8 snapshots before the final scoped durable result", async () => {
  let enqueue!: (text: string) => void, close!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      enqueue = (s) => c.enqueue(new TextEncoder().encode(s));
      close = () => c.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, {
          headers: { "content-type": "application/x-ndjson" },
        }),
    ),
  );
  const progress = vi.fn();
  const task = new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: progress },
  );
  enqueue(
    JSON.stringify({
      type: "text",
      replyId: input.replyId,
      conversationId: input.conversationId,
      text: "Voici le début…",
    }) + "\n",
  );
  await vi.waitFor(() =>
    expect(progress).toHaveBeenCalledWith("Voici le début…"),
  );
  enqueue(
    JSON.stringify({
      type: "result",
      result: { message, alreadyApplied: false },
    }) + "\n",
  );
  close();
  expect((await task).message).toEqual(message);
});
it("rejects cross-conversation snapshots and interrupted streams instead of persisting a partial reply", async () => {
  for (const event of [
    {
      type: "text",
      replyId: id(9),
      conversationId: input.conversationId,
      text: "wrong",
    },
    {
      type: "text",
      replyId: input.replyId,
      conversationId: input.conversationId,
      text: "partial",
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(event) + "\n", {
            headers: { "content-type": "application/x-ndjson" },
          }),
      ),
    );
    await expect(
      new ApiClient("https://test.invalid").copilotTurn(
        "test",
        id(4),
        id(5),
        input,
        undefined,
        { onProgress: vi.fn() },
      ),
    ).rejects.toThrow();
  }
});
it("cancels an idle stream promptly when leaving the conversation", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
    ),
  );
  const abort = new AbortController();
  const task = new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    abort.signal,
    { onProgress: vi.fn() },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await expect(task).rejects.toThrow("COPILOT_STREAM_CANCELLED");
  expect(cancel).toHaveBeenCalled();
});
it("negotiates and scopes public activity events without persisting them in the reply", async () => {
  const activity = { id: "read-0", stage: "ANALYTICS", status: "RUNNING" };
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          type: "activity",
          replyId: input.replyId,
          conversationId: input.conversationId,
          activity,
        }) +
          "\n" +
          JSON.stringify({
            type: "result",
            result: { message, alreadyApplied: false },
          }) +
          "\n",
        { headers: { "content-type": "application/x-ndjson" } },
      ),
  );
  vi.stubGlobal("fetch", transport);
  const onActivity = vi.fn();
  const result = await new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: vi.fn(), onActivity },
  );
  expect(onActivity).toHaveBeenCalledWith(activity);
  expect(transport.mock.calls[0]![1]!.headers).toHaveProperty(
    "x-copilot-activity",
    "1",
  );
  expect(result.message).toEqual(message);
});
it("opts into memory and web sources only when the client supports their renderer", async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          type: "result",
          result: { message, alreadyApplied: false },
        }) + "\n",
        { headers: { "content-type": "application/x-ndjson" } },
      ),
  );
  vi.stubGlobal("fetch", transport);
  for (const enabled of [false, true]) {
    await new ApiClient("https://test.invalid").copilotTurn(
      "test",
      id(4),
      id(5),
      input,
      undefined,
      { onProgress: vi.fn(), memorySuggestions: enabled, webResearch: enabled },
    );
    const headers = transport.mock.calls.at(-1)![1]!.headers;
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-memory-suggestions", "1");
    else expect(headers).not.toHaveProperty("x-copilot-memory-suggestions");
    if (enabled) expect(headers).toHaveProperty("x-copilot-web-research", "1");
    else expect(headers).not.toHaveProperty("x-copilot-web-research");
  }
});
