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
