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
        "x-copilot-analytics-destinations": "1",
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
it("opts into optional proposal and source tools only when the client supports their renderer", async () => {
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
      {
        onProgress: vi.fn(),
        memorySuggestions: enabled,
        webResearch: enabled,
        retailExpertise: enabled,
        recommendationTracking: enabled,
        executionLinks: enabled,
        actionExecutions: enabled,
        choiceUpdate: enabled,
        choiceRetention: enabled,
        choiceCreate: enabled,
        offerValidation: enabled,
        planValidation: enabled,
        commercialReference: enabled,
        choiceReassociation: enabled,
        choiceWithdrawal: enabled,
        preparationProposals: enabled,
        preparationLayout: enabled,
        preparationCreate: enabled,
        preparationSelection: enabled,
        preparationRefresh: enabled,
        layoutScenarios: enabled,
        layoutPreparation: enabled,
        layoutEdits: enabled,
        storeOperations: enabled,
        needProposals: enabled,
        storeConflicts: enabled,
        receiptRecovery: enabled,
        receiptCorrection: enabled,
        receiptPublication: enabled,
        identityReview: enabled,
        catalogueProposals: enabled,
        executionProposals: enabled,
      },
    );
    const headers = transport.mock.calls.at(-1)![1]!.headers;
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-action-executions", "1");
    else expect(headers).not.toHaveProperty("x-copilot-action-executions");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-execution-links", "1");
    else expect(headers).not.toHaveProperty("x-copilot-execution-links");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-recommendation-tracking", "1");
    else
      expect(headers).not.toHaveProperty("x-copilot-recommendation-tracking");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-retail-expertise", "1");
    else expect(headers).not.toHaveProperty("x-copilot-retail-expertise");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-store-conflicts", "1");
    else expect(headers).not.toHaveProperty("x-copilot-store-conflicts");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-receipt-recovery", "1");
    else expect(headers).not.toHaveProperty("x-copilot-receipt-recovery");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-receipt-correction", "1");
    else expect(headers).not.toHaveProperty("x-copilot-receipt-correction");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-receipt-publication", "1");
    else expect(headers).not.toHaveProperty("x-copilot-receipt-publication");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-identity-review", "1");
    else expect(headers).not.toHaveProperty("x-copilot-identity-review");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-commercial-reference", "1");
    else expect(headers).not.toHaveProperty("x-copilot-commercial-reference");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-plan-validation", "1");
    else expect(headers).not.toHaveProperty("x-copilot-plan-validation");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-offer-validation", "1");
    else expect(headers).not.toHaveProperty("x-copilot-offer-validation");
    if (enabled) expect(headers).toHaveProperty("x-copilot-choice-create", "1");
    else expect(headers).not.toHaveProperty("x-copilot-choice-create");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-choice-retention", "1");
    else expect(headers).not.toHaveProperty("x-copilot-choice-retention");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-choice-reassociation", "1");
    else expect(headers).not.toHaveProperty("x-copilot-choice-reassociation");
    if (enabled) expect(headers).toHaveProperty("x-copilot-choice-update", "1");
    else expect(headers).not.toHaveProperty("x-copilot-choice-update");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-choice-withdrawal", "1");
    else expect(headers).not.toHaveProperty("x-copilot-choice-withdrawal");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-preparation-refresh", "1");
    else expect(headers).not.toHaveProperty("x-copilot-preparation-refresh");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-memory-suggestions", "1");
    else expect(headers).not.toHaveProperty("x-copilot-memory-suggestions");
    if (enabled) expect(headers).toHaveProperty("x-copilot-web-research", "1");
    else expect(headers).not.toHaveProperty("x-copilot-web-research");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-preparation-selection", "1");
    else expect(headers).not.toHaveProperty("x-copilot-preparation-selection");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-preparation-create", "1");
    else expect(headers).not.toHaveProperty("x-copilot-preparation-create");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-preparation-layout", "1");
    else expect(headers).not.toHaveProperty("x-copilot-preparation-layout");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-preparation-proposals", "1");
    else expect(headers).not.toHaveProperty("x-copilot-preparation-proposals");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-layout-preparation", "1");
    else expect(headers).not.toHaveProperty("x-copilot-layout-preparation");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-layout-scenarios", "1");
    else expect(headers).not.toHaveProperty("x-copilot-layout-scenarios");
    if (enabled) expect(headers).toHaveProperty("x-copilot-layout-edits", "1");
    else expect(headers).not.toHaveProperty("x-copilot-layout-edits");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-store-operations", "1");
    else expect(headers).not.toHaveProperty("x-copilot-store-operations");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-need-proposals", "1");
    else expect(headers).not.toHaveProperty("x-copilot-need-proposals");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-catalogue-proposals", "1");
    else expect(headers).not.toHaveProperty("x-copilot-catalogue-proposals");
    if (enabled)
      expect(headers).toHaveProperty("x-copilot-execution-proposals", "1");
    else expect(headers).not.toHaveProperty("x-copilot-execution-proposals");
  }
  await new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: vi.fn(), storeConflicts: 2 },
  );
  expect(transport.mock.calls.at(-1)![1]!.headers).toHaveProperty(
    "x-copilot-store-conflicts",
    "2",
  );
  await new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: vi.fn(), storeConflicts: 3 },
  );
  expect(transport.mock.calls.at(-1)![1]!.headers).toHaveProperty(
    "x-copilot-store-conflicts",
    "3",
  );
  await new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: vi.fn(), storeConflicts: 4 },
  );
  expect(transport.mock.calls.at(-1)![1]!.headers).toHaveProperty(
    "x-copilot-store-conflicts",
    "4",
  );
  await new ApiClient("https://test.invalid").copilotTurn(
    "test",
    id(4),
    id(5),
    input,
    undefined,
    { onProgress: vi.fn(), storeConflicts: 5 },
  );
  expect(transport.mock.calls.at(-1)![1]!.headers).toHaveProperty(
    "x-copilot-store-conflicts",
    "5",
  );
});

it("advertises deletion-aware private history to avoid legacy projections on the updated app", async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          storeId: id(4),
          ownerId: id(5),
          conversationId: null,
          conversations: [],
          messages: [],
          hasMore: false,
          before: null,
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", transport);
  await new ApiClient("https://test.invalid").copilotHistory("test", id(4));
  expect(transport.mock.calls[0]![1]).toHaveProperty(
    "headers.x-copilot-history-deletion",
    "1",
  );
});
it("sends only bounded labels to authenticated import classification with cancellation", async () => {
  const transport = vi.fn(
    async () =>
      new Response(JSON.stringify({ model: "test", suggestions: [] })),
  );
  vi.stubGlobal("fetch", transport);
  const signal = new AbortController().signal;
  await new ApiClient("https://test.invalid").importClassification(
    "test-token",
    id(4),
    { labels: ["Poire"] },
    signal,
  );
  expect(transport).toHaveBeenCalledWith(
    "https://test.invalid/api/v1/copilot/import-classification",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ labels: ["Poire"] }),
      signal,
      headers: expect.objectContaining({
        authorization: "Bearer test-token",
        "x-store-id": id(4),
      }),
    }),
  );
});

it("advertises catalogue receipt correction v2 explicitly without adding model mutation authority to the body", async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ message, alreadyApplied: false }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", transport);
  await new ApiClient("https://test.invalid").copilotTurn(
    "test-token",
    id(4),
    id(5),
    input,
    undefined,
    { receiptCorrection: 2, onProgress: vi.fn() },
  );
  expect(transport.mock.calls[0]![1]!.headers).toHaveProperty(
    "x-copilot-receipt-correction",
    "2",
  );
  expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual(input);
});

it("advertises analytical destinations on turn, history, bootstrap and incremental pull without adding model/request fields", async () => {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      paths.push(new URL(url).pathname);
      expect(
        new Headers(init?.headers).get("x-copilot-analytics-destinations"),
      ).toBe("1");
      return new Response(
        JSON.stringify({
          code: "UNAVAILABLE",
          messageFr: "Indisponible",
          retryable: false,
        }),
        { status: 503 },
      );
    }),
  );
  const api = new ApiClient("https://test.invalid");
  await expect(
    api.copilotTurn("token", id(4), id(5), input),
  ).rejects.toBeInstanceOf(ApiClientError);
  await expect(api.bootstrapSync("token", id(4))).rejects.toBeInstanceOf(
    ApiClientError,
  );
  await expect(api.pullSync("token", id(4))).rejects.toBeInstanceOf(
    ApiClientError,
  );
  await expect(
    api.copilotHistory("token", id(4), id(2)),
  ).rejects.toBeInstanceOf(ApiClientError);
  expect(paths).toHaveLength(4);
});
