import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const unavailable = () =>
  new Response(
    JSON.stringify({
      code: "UNAVAILABLE",
      messageFr: "Indisponible",
      retryable: false,
    }),
    { status: 503 },
  );

it("opts into automatic capture through the authenticated capability header without changing the question payload", async () => {
  const transport = vi.fn<typeof fetch>(async () => unavailable());
  vi.stubGlobal("fetch", transport);
  const question = {
    conversationId: id(1),
    userMessageId: id(2),
    replyId: id(3),
  };
  await expect(
    new ApiClient("https://fixture.invalid").copilotTurn(
      "test-token",
      id(4),
      id(5),
      question,
      undefined,
      { onProgress: () => {}, memorySuggestions: 2 },
    ),
  ).rejects.toBeInstanceOf(ApiClientError);
  const init = transport.mock.calls[0]?.[1] as RequestInit;
  expect(init.headers).toHaveProperty("x-copilot-memory-suggestions", "2");
  expect(JSON.parse(String(init.body))).toEqual(question);
});

it.each([false, true])(
  "negotiates capture provenance independently on bootstrap and pull (%s)",
  async (enabled) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        urls.push(String(url));
        return unavailable();
      }),
    );
    const api = new ApiClient("https://fixture.invalid");
    const pull: Parameters<ApiClient["pullSync"]> = ["test-token", id(4)];
    pull[21] = true;
    pull[37] = enabled;
    const boot: Parameters<ApiClient["bootstrapSync"]> = ["test-token", id(4)];
    boot[20] = true;
    boot[35] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const url of urls) {
      const query = new URL(url).searchParams;
      expect(query.get("copilotKnowledge")).toBe("true");
      expect(query.get("automaticMemory")).toBe(enabled ? "true" : null);
    }
  },
);
