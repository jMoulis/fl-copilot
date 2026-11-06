import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { copilotResponseSchema } from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { parseEnvironment } from "../config";
import {
  createCopilotAiProvider,
  type CopilotGenerationRequest,
} from "./ai-provider";
import { buildDispatchInput } from "./dispatch";
function fixture() {
  const storeId = randomUUID(),
    evaluatedAt = "2026-11-06T10:00:00.000Z";
  const config = parseEnvironment({
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test-not-a-real-api-key",
    COPILOT_AI_MODEL: "expert-test",
  });
  const request: CopilotGenerationRequest = {
    requestId: randomUUID(),
    storeId,
    context: detectCopilotConflicts({
      batch: scoreCopilotPriorities({ storeId, evaluatedAt, candidates: [] }),
      intents: [],
    }),
    conversationTitle: "Nouvelle conversation",
    userQuestion: "Salut !",
  };
  return { config, request };
}
function reply(value: unknown, model = "gpt-6-luna") {
  return Response.json({
    id: randomUUID(),
    object: "response",
    model,
    status: "completed",
    created_at: 1,
    output: [
      {
        id: randomUUID(),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: JSON.stringify(value), annotations: [] },
        ],
      },
    ],
    usage: {
      input_tokens: 90,
      output_tokens: 20,
      total_tokens: 110,
      input_tokens_details: { cached_tokens: 10 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}
const expert = {
  language: "fr-FR",
  summary: "Je reprends les éléments utiles.",
  narrative: "Je reprends les éléments utiles.",
  facts: [],
  interpretation: [],
  recommendations: [],
  questions: [],
};
const decision = {
  route: "SIMPLE",
  confidence: "HIGH",
  answer: "Salut ! Comment ça se passe au rayon ?",
  title: null,
};
it("answers a simple exchange and proposes its title in one light request with no business tools", async () => {
  const f = fixture(),
    usage = vi.fn(),
    partial = vi.fn(),
    daily = vi.fn();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply({ ...decision, title: "Présentation des produits" }),
    );
  const provider = createCopilotAiProvider(f.config, transport, {
    dispatchEnabled: true,
    daily,
    onUsage: usage,
  });
  const result = await provider.generate(
    f.request,
    copilotResponseSchema,
    undefined,
    partial,
  );
  expect(transport).toHaveBeenCalledTimes(1);
  const body = JSON.parse(transport.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({
    model: "gpt-6-luna",
    store: false,
    max_output_tokens: 512,
    reasoning: { effort: "none" },
  });
  expect(body.tools ?? []).toEqual([]);
  expect(result.output.narrative).toBe(decision.answer);
  expect(result.titleProposal).toBe("Présentation des produits");
  expect(result.metadata).toMatchObject({
    requestedModel: "gpt-6-luna",
    inputTokens: 90,
    outputTokens: 20,
  });
  expect(partial).toHaveBeenCalledTimes(1);
  expect(daily).not.toHaveBeenCalled();
  expect(usage.mock.calls.map(([e]) => e)).toEqual([
    expect.objectContaining({
      kind: "STEP",
      purpose: "DISPATCH",
      parentRequestId: f.request.requestId,
      inputTokens: 90,
      outputTokens: 20,
      cacheReadTokens: 10,
      toolCallCount: 0,
    }),
    expect.objectContaining({
      kind: "END",
      purpose: "DISPATCH",
      outcome: "COMPLETED",
      usageComplete: true,
    }),
  ]);
  expect(JSON.stringify(usage.mock.calls)).not.toContain("Salut");
});
it.each(["EXPERT", "UNCERTAIN", "DOCUMENT", "FORM", "LONG"])(
  "keeps the existing expert path for %s",
  async (kind) => {
    const f = fixture();
    f.request.userQuestion =
      kind === "LONG" ? "a".repeat(1801) : "Et pour la banane ?";
    if (kind === "DOCUMENT")
      f.request.attachedSources = [
        {
          sourceDocumentId: randomUUID(),
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          filename: "source.pdf",
          mediaType: "application/pdf",
          status: "CONFIRMED",
          registeredAt: "2026-11-06T10:00:00.000Z",
        },
      ];
    if (kind === "FORM")
      f.request.answeredInformation = {
        formId: randomUUID(),
        sourceQuestionId: randomUUID(),
        title: "Question",
        reason: "Préciser",
        fields: [{ type: "DATE", key: "date", label: "Date", required: true }],
        originalQuestion: null,
        originalQuestionOmitted: false,
        superseded: false,
      };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({
          ...decision,
          route: kind === "EXPERT" ? "EXPERT" : "SIMPLE",
          confidence: kind === "UNCERTAIN" ? "UNCERTAIN" : "HIGH",
          answer: kind === "EXPERT" ? null : decision.answer,
          title: "Suivi de la banane",
        }),
      )
      .mockResolvedValueOnce(reply(expert, "expert-test"));
    const result = await createCopilotAiProvider(f.config, transport, {
      dispatchEnabled: true,
      daily: vi.fn(),
    }).generate(f.request, copilotResponseSchema);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string).model).toBe(
      "expert-test",
    );
    expect(result.metadata.requestedModel).toBe("expert-test");
    expect(result.titleProposal).toBe(
      kind === "UNCERTAIN" ? undefined : "Suivi de la banane",
    );
  },
);
it.each([429, 503])(
  "does not retry a failed dispatch (%s) and falls back once to the expert",
  async (status) => {
    const f = fixture();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Unavailable", type: "server_error" } },
          { status },
        ),
      )
      .mockResolvedValueOnce(reply(expert, "expert-test"));
    const usage = vi.fn();
    const result = await createCopilotAiProvider(f.config, transport, {
      dispatchEnabled: true,
      daily: vi.fn(),
      onUsage: usage,
    }).generate(f.request, copilotResponseSchema);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.metadata.requestedModel).toBe("expert-test");
    expect(usage.mock.calls.map(([e]) => e)).toContainEqual(
      expect.objectContaining({
        kind: "END",
        purpose: "DISPATCH",
        outcome: "FAILED",
        usageComplete: false,
      }),
    );
  },
);
it("retains the old path for unadvertised clients and the global kill switch", async () => {
  for (const enabled of [undefined, false]) {
    const f = fixture();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(expert, "expert-test"));
    await createCopilotAiProvider(f.config, transport, {
      dispatchEnabled: enabled,
      daily: vi.fn(),
    }).generate(f.request, copilotResponseSchema);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string).model).toBe(
      "expert-test",
    );
  }
  const f = fixture();
  f.config.COPILOT_AI_ROUTING_ENABLED = false;
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(expert, "expert-test"));
  await createCopilotAiProvider(f.config, transport, {
    dispatchEnabled: true,
    daily: vi.fn(),
  }).generate(f.request, copilotResponseSchema);
  expect(transport).toHaveBeenCalledTimes(1);
});
it("bounds the routing context without exposing the business evidence or full history", () => {
  const f = fixture();
  f.request.history = {
    messages: Array.from({ length: 20 }, () => ({
      id: randomUUID(),
      role: "USER" as const,
      text: "x".repeat(16000),
      createdAt: "2026-11-06T10:00:00.000Z",
    })),
    earlierMessagesOmitted: true,
  };
  f.request.userQuestion = "y".repeat(6000);
  const input = buildDispatchInput(f.request);
  expect(input.history).toHaveLength(4);
  expect(input.history.every((m) => m.text.length === 600)).toBe(true);
  expect(input.question).toHaveLength(1800);
  expect(input.truncated).toBe(true);
  expect(JSON.stringify(input)).not.toContain(f.request.storeId);
  expect(JSON.stringify(input).length).toBeLessThan(5000);
});
it("does not dispatch or fall back after cancellation", async () => {
  const f = fixture(),
    transport = vi.fn<typeof fetch>(),
    abort = new AbortController();
  abort.abort();
  await expect(
    createCopilotAiProvider(f.config, transport, {
      dispatchEnabled: true,
      daily: vi.fn(),
    }).generate(f.request, copilotResponseSchema, abort.signal),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  "Ton CA est de 123 euros.",
  "Voir {{fact:0}}",
  "[Source](copilot-source:private)",
  "Voir https://example.test",
])(
  "escalates an unsupported lightweight answer instead of bypassing grounding: %s",
  async (answer) => {
    const f = fixture();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ ...decision, answer }))
      .mockResolvedValueOnce(reply(expert, "expert-test"));
    const result = await createCopilotAiProvider(f.config, transport, {
      dispatchEnabled: true,
      daily: vi.fn(),
    }).generate(f.request, copilotResponseSchema);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.metadata.requestedModel).toBe("expert-test");
  },
);
it("removes signed/source URLs from the dispatch excerpt and keeps linked requests on the expert path", async () => {
  const f = fixture();
  f.request.userQuestion = "Lis https://example.test/private?token=secret";
  f.request.history = {
    earlierMessagesOmitted: false,
    messages: [
      {
        id: randomUUID(),
        role: "ASSISTANT",
        createdAt: "2026-11-06T10:00:00.000Z",
        text: "Texte [Source](copilot-source:private-id) https://example.test/private",
      },
    ],
  };
  expect(JSON.stringify(buildDispatchInput(f.request))).not.toMatch(
    /https:|token=secret|copilot-source:private-id/,
  );
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(decision))
    .mockResolvedValueOnce(reply(expert, "expert-test"));
  await createCopilotAiProvider(f.config, transport, {
    dispatchEnabled: true,
    daily: vi.fn(),
  }).generate(f.request, copilotResponseSchema);
  expect(transport).toHaveBeenCalledTimes(2);
});
