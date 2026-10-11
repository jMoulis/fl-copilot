import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { parseEnvironment } from "../config";
import { createCopilotWebResearch } from "./web-research";
const request = () => ({
  requestId: randomUUID(),
  query: "Saisonnalité des poires en France",
  purpose: "PRODUCE",
});
const config = () =>
  parseEnvironment({
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
    COPILOT_AI_MODEL: "test-model",
    COPILOT_AI_TIMEOUT_MS: "1000",
  });
function response(
  url = "https://www.interfel.com/fruits-et-legumes/poire/",
  cited = true,
) {
  return new Response(
    JSON.stringify({
      id: "resp-test",
      object: "response",
      created_at: 1,
      model: "resolved-test-model",
      status: "completed",
      output: [
        {
          id: "search-test",
          type: "web_search_call",
          status: "completed",
          action: { type: "search", query: "saisonnalité poire" },
        },
        {
          id: "message-test",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Les périodes varient selon les variétés.",
              annotations: cited
                ? [
                    {
                      type: "url_citation",
                      url,
                      title: "Interfel",
                      start_index: 0,
                      end_index: 12,
                    },
                  ]
                : [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
it("uses the real SDK/web tool, retains citation spans and external provenance, enforces request bounds and sends no private context", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    body = JSON.parse(String(init?.body));
    return response();
  });
  const r = await createCopilotWebResearch(
    config(),
    transport,
    () => new Date("2026-10-11T12:00:00Z"),
  ).research(request());
  expect(r.kind).toBe("EXTERNAL_RESEARCH");
  expect(r.citations[0]).toMatchObject({
    title: "Interfel",
    start: 0,
    end: 12,
    publishedAt: null,
  });
  expect(r.accessedAt).toBe("2026-10-11T12:00:00.000Z");
  expect(r.model).toBe("resolved-test-model");
  expect(body).toMatchObject({
    store: false,
    max_tool_calls: 2,
    max_output_tokens: 2000,
    tools: [{ type: "web_search", search_context_size: "low" }],
  });
  expect(JSON.stringify(body)).not.toContain(config().OPENAI_API_KEY);
  expect(JSON.stringify(body)).not.toContain("storeId");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("rejects private URLs, credentials, email, forged authority and pre-cancelled calls before transport", async () => {
  const transport = vi.fn<typeof fetch>(),
    p = createCopilotWebResearch(config(), transport);
  for (const query of [
    "Consulte https://localhost/test",
    "Lis https://127.0.0.1/test",
    "Lis https://fl-copilot.vercel.app/private",
    "Lis https://store.blob.vercel-storage.com/private.pdf",
    "Voici sk-test-secrete",
    "Envoie à julien@example.com",
    "Lis https://example.org/file?signature=abc",
    "Lis https://example.org/file#access_token=abc",
  ])
    await expect(p.research({ ...request(), query })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  await expect(
    p.research({ ...request(), storeId: randomUUID() }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const c = new AbortController();
  c.abort();
  await expect(p.research(request(), c.signal)).rejects.toMatchObject({
    code: "CANCELLED",
  });
  expect(transport).not.toHaveBeenCalled();
});
it("does not return an unsupported or unsafe-cited answer, invent dates or echo provider errors", async () => {
  await expect(
    createCopilotWebResearch(config(), async () =>
      response(undefined, false),
    ).research(request()),
  ).rejects.toMatchObject({ code: "NO_CITATIONS" });
  await expect(
    createCopilotWebResearch(config(), async () =>
      response("https://example.org/?token=secret"),
    ).research(request()),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  const transport = vi.fn<typeof fetch>(async () => {
    throw Error("private provider secret");
  });
  await expect(
    createCopilotWebResearch(config(), transport).research(request()),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  expect(transport).toHaveBeenCalledTimes(1);
  const none = vi.fn<typeof fetch>();
  await expect(
    createCopilotWebResearch(
      parseEnvironment({ NODE_ENV: "test" }),
      none,
    ).research(request()),
  ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  expect(none).not.toHaveBeenCalled();
});
it("bounds in-flight cancellation and timeout without retries", async () => {
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    entered?.();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted transport")),
        { once: true },
      );
    });
  });
  const controller = new AbortController(),
    pending = createCopilotWebResearch(config(), transport).research(
      request(),
      controller.signal,
    );
  await ready;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  expect(transport).toHaveBeenCalledTimes(1);
  const timeoutTransport = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("timeout transport")),
          { once: true },
        );
      }),
  );
  await expect(
    createCopilotWebResearch(config(), timeoutTransport).research(request()),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(timeoutTransport).toHaveBeenCalledTimes(1);
});
