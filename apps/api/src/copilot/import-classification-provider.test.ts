import { it, expect, vi } from "vitest";
import { parseEnvironment } from "../config";
import { createImportClassifier } from "./import-classification-provider";
const config = parseEnvironment({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
  COPILOT_AI_MODEL: "test-model",
});
function response(text: string) {
  return new Response(
    JSON.stringify({
      id: "resp-test",
      object: "response",
      created_at: 1,
      model: "resolved-test",
      status: "completed",
      output: [
        {
          id: "msg-test",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
  );
}
it("uses the installed SDK object output with no tools, server key and exact-label validation", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return response(
      JSON.stringify({
        suggestions: [
          {
            label: "Poire",
            category: "FRUIT",
            confidence: 0.99,
            reason: "Fruit courant.",
          },
        ],
      }),
    );
  });
  expect(
    await createImportClassifier(config, transport)({ labels: ["Poire"] }),
  ).toMatchObject({
    model: "resolved-test",
    suggestions: [{ label: "Poire", category: "FRUIT" }],
  });
  expect(body).toMatchObject({ model: "test-model", store: false });
  expect(body?.tools ?? []).toEqual([]);
  expect(JSON.stringify(body)).not.toContain(config.OPENAI_API_KEY);
  expect(JSON.stringify(body)).toContain("untrusted data");
  expect(transport).toHaveBeenCalledOnce();
});
it("rejects missing configuration, input bounds, foreign output and cancellation without automatic retries", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    response(
      JSON.stringify({
        suggestions: [
          { label: "foreign", category: "FRUIT", confidence: 1, reason: "bad" },
        ],
      }),
    ),
  );
  await expect(
    createImportClassifier(
      { ...config, OPENAI_API_KEY: undefined },
      transport,
    )({ labels: ["Poire"] }),
  ).rejects.toThrow();
  await expect(
    createImportClassifier(
      { ...config, COPILOT_AI_MAX_INPUT_BYTES: 1 },
      transport,
    )({ labels: ["Poire"] }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  await expect(
    createImportClassifier(config, transport)({ labels: ["Poire"] }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledOnce();
});
