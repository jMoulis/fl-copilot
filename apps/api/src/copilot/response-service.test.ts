import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import {
  priorityFixture,
  priorityStoreId,
  priorityEvaluatedAt,
} from "../../../../scripts/test-copilot-priority-fixtures";
import {
  CopilotAiError,
  type CopilotAiProvider,
  type CopilotGenerationRequest,
} from "./ai-provider";
import {
  generateCopilotResponse,
  validateCopilotResponse,
} from "./response-service";
function request(): CopilotGenerationRequest {
  const candidate = priorityFixture("candidate", {
    evidence: [
      {
        id: "sales",
        sourceType: "KPI",
        sourceId: "daily",
        sourceVersion: 1,
        label: "Ventes",
        value: 25,
        factKind: "OBSERVED",
      },
    ],
  });
  return {
    requestId: randomUUID(),
    storeId: priorityStoreId,
    userQuestion: null,
    context: detectCopilotConflicts({
      batch: scoreCopilotPriorities({
        storeId: priorityStoreId,
        evaluatedAt: priorityEvaluatedAt,
        candidates: [candidate],
      }),
      intents: [],
    }),
  };
}
const answer = {
  language: "fr-FR",
  summary: "Les ventes sont disponibles.",
  facts: [{ evidenceId: "sales" }],
  interpretation: [],
  recommendations: [],
  questions: [],
};
it("validates references and rejects invented facts and numeric prose", () => {
  const r = request();
  expect(validateCopilotResponse(answer, r)).toEqual(answer);
  expect(() =>
    validateCopilotResponse(
      { ...answer, facts: [{ evidenceId: "invented" }] },
      r,
    ),
  ).toThrow("UNKNOWN_EVIDENCE");
  expect(() =>
    validateCopilotResponse({ ...answer, summary: "La marge est de 99 %." }, r),
  ).toThrow("UNSUPPORTED_NUMBER");
  expect(() =>
    validateCopilotResponse({ ...answer, summary: "Le 2026-02-30." }, r),
  ).toThrow("UNSUPPORTED_NUMBER");
});
it("returns safe evidence fallback for unavailable or ungrounded generation", async () => {
  for (const error of [
    new CopilotAiError("COPILOT_AI_UNAVAILABLE", true),
    new CopilotAiError("COPILOT_AI_NOT_CONFIGURED", false),
  ]) {
    const provider = {
      model: null,
      generate: vi.fn().mockRejectedValue(error),
    } as CopilotAiProvider;
    const result = await generateCopilotResponse(provider, request());
    expect(result.mode).toBe("FALLBACK");
    expect(result.response.facts).toEqual([{ evidenceId: "sales" }]);
    expect(result.response.recommendations).toHaveLength(1);
    expect(result.response.recommendations[0]?.candidateId).toBe(
      request().context.batch.candidates[0]!.id,
    );
    expect(result.metadata).toBeNull();
    expect(JSON.stringify(result)).not.toContain(error.code);
  }
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      metadata: null,
    }),
  } as CopilotAiProvider;
  expect((await generateCopilotResponse(provider, request())).mode).toBe(
    "FALLBACK",
  );
});
it("does not turn cancellation or invalid scope into fallback", async () => {
  const provider = { model: null, generate: vi.fn() } as CopilotAiProvider;
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateCopilotResponse(provider, request(), controller.signal),
  ).rejects.toMatchObject({ code: "COPILOT_AI_CANCELLED" });
  await expect(
    generateCopilotResponse(provider, { ...request(), storeId: randomUUID() }),
  ).rejects.toMatchObject({ code: "COPILOT_AI_INPUT_INVALID" });
  expect(provider.generate).not.toHaveBeenCalled();
});

it("rejects ambiguous evidence IDs and omits them from outage fallback", async () => {
  const r = request();
  const original = r.context.batch.candidates[0]!;
  r.context.batch.candidates.push({
    ...original,
    id: "other",
    evidence: original.evidence.map((e) => ({ ...e, value: 999 })),
  });
  expect(() => validateCopilotResponse(answer, r)).toThrow(
    "AMBIGUOUS_EVIDENCE",
  );
  const provider = {
    model: null,
    generate: vi
      .fn()
      .mockRejectedValue(new CopilotAiError("COPILOT_AI_UNAVAILABLE", true)),
  } as CopilotAiProvider;
  expect((await generateCopilotResponse(provider, r)).response.facts).toEqual(
    [],
  );
});

it("preserves deterministic priority order and rejects ineligible recommendations", () => {
  const r = request();
  const first = r.context.batch.candidates[0]!;
  first.priority.score = 0.2;
  r.context.batch.candidates.push({
    ...first,
    id: "higher",
    priority: { ...first.priority, score: 0.8 },
  });
  const recommendation = {
    candidateId: first.id,
    type: first.type,
    title: "Examiner les ventes",
    explanation: "Consulter les observations disponibles.",
    evidenceIds: ["sales"],
    confidence: "LOW",
    risks: [],
    missingData: [],
    measurement: {
      objective: "Comparer les périodes complètes.",
      evidenceIds: ["sales"],
      reviewWhen: "Après réception des données.",
    },
  };
  expect(() =>
    validateCopilotResponse(
      {
        ...answer,
        recommendations: [
          recommendation,
          { ...recommendation, candidateId: "higher" },
        ],
      },
      r,
    ),
  ).toThrow("PRIORITY_ORDER_INVALID");
  expect(
    validateCopilotResponse(
      {
        ...answer,
        recommendations: [
          { ...recommendation, candidateId: "higher" },
          recommendation,
        ],
      },
      r,
    ).recommendations,
  ).toHaveLength(2);
  first.status = "TO_REVIEW";
  expect(() =>
    validateCopilotResponse(
      { ...answer, recommendations: [recommendation] },
      r,
    ),
  ).toThrow("INVALID_CANDIDATE");
});

it("uses standalone trusted facts without inventing a recommendation candidate", async () => {
  const r = request();
  r.evidence = r.context.batch.candidates[0]!.evidence;
  r.context.batch.candidates = [];
  expect(validateCopilotResponse(answer, r).facts).toEqual(answer.facts);
  const provider = {
    model: null,
    generate: vi
      .fn()
      .mockRejectedValue(new CopilotAiError("COPILOT_AI_UNAVAILABLE", true)),
  } as CopilotAiProvider;
  const result = await generateCopilotResponse(provider, r);
  expect(result.response.facts).toEqual([{ evidenceId: "sales" }]);
  expect(result.response.recommendations).toEqual([]);
  r.evidence.push({ ...r.evidence[0]!, value: 999 });
  expect(() => validateCopilotResponse(answer, r)).toThrow(
    "AMBIGUOUS_EVIDENCE",
  );
});

it("grounds a tool-derived fact against the trusted returned evidence pool, not model prose", async () => {
  const r = request();
  const evidence = {
    id: "queried-day",
    sourceType: "COMPARISON" as const,
    sourceId: "canonical-comparison",
    sourceVersion: null,
    label: "Écart de ventes daté",
    value: "25.50",
    factKind: "DERIVED" as const,
  };
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, facts: [{ evidenceId: evidence.id }] },
      toolEvidence: [evidence],
      metadata: {
        requestedModel: "test",
        resolvedModel: "test",
        responseId: "test",
        inputTokens: 1,
        outputTokens: 1,
      },
    }),
  } as CopilotAiProvider;
  const result = await generateCopilotResponse(provider, r);
  expect(result.mode).toBe("AI");
  expect(result.evidence).toContainEqual(evidence);
  expect(result.response.facts).toEqual([{ evidenceId: "queried-day" }]);
  expect(r.evidence).toBeUndefined();
});
it("streams resolved values while withholding unsupported numeric or unknown-reference partials", async () => {
  const progress = vi.fn(),
    r = request();
  const provider: CopilotAiProvider = {
    model: "test",
    async generate(_request, schema, _signal, onPartial) {
      onPartial?.({ ...answer, narrative: "Le CA est de 999 €." }, []);
      onPartial?.({ ...answer, narrative: "Le CA est de {{value:0}} €." }, []);
      return {
        output: schema.parse({
          ...answer,
          narrative: "Le CA est de {{value:0}} €. {{source:0}}",
        }),
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test",
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    },
  };
  const result = await generateCopilotResponse(
    provider,
    r,
    undefined,
    progress,
  );
  expect(result.mode).toBe("AI");
  expect(progress.mock.calls).toEqual([["Le CA est de 25 €."]]);
});

it("keeps the verified butternut nature/unit card when final prose fails grounding, without claiming the edit was saved", async () => {
  const { commercialChoiceFixture } =
    await import("../../../../scripts/test-commercial-choice-fixtures");
  const { compareProductClassification } = await import("@fl-copilot/domain");
  const { buildCopilotResponseMessage } = await import("./response-message");
  const { buildProductProposalMessages } =
    await import("./product-proposal-messages");
  const { chatFixture } =
    await import("../../../../scripts/test-chat-fixtures");
  const r = request(),
    source = await commercialChoiceFixture({ storeId: r.storeId }),
    chat = chatFixture(randomUUID);
  const before = {
    ...source.product,
    nature: "UNKNOWN" as const,
    salesUnit: "UNKNOWN" as const,
  };
  const input = {
    productId: before.id,
    patch: { nature: "BULK" as const, salesUnit: "PIECE" as const },
  };
  const previews = [
    {
      input,
      result: {
        productId: before.id,
        status: "PREVIEW" as const,
        preview: compareProductClassification(before, input.patch),
        evidence: [
          {
            id: "preview",
            sourceType: "DATA_QUALITY" as const,
            sourceId: before.id,
            sourceVersion: before.version,
            label: "Aperçu",
            value: "Non enregistré",
            factKind: "QUALITY" as const,
          },
        ],
      },
    },
  ];
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      productPreviews: previews,
      metadata: null,
    }),
  } as CopilotAiProvider;
  const generated = await generateCopilotResponse(provider, r);
  expect(generated.mode).toBe("FALLBACK");
  expect(generated.productPreviews).toEqual(previews);
  const message = buildCopilotResponseMessage({
    id: randomUUID(),
    createdAt: chat.message.createdAt,
    parent: {
      ...chat.message,
      storeId: r.storeId,
      text: "Sans emballage et vendu à la pièce.",
      attachments: [],
    },
    request: r,
    generation: generated,
  });
  expect(message.text).toContain("Rien n’a encore été modifié");
  expect(message.text).not.toContain("999");
  expect(message.text).not.toContain("Faits disponibles");
  const [card] = buildProductProposalMessages(
    message,
    generated.productPreviews!,
  );
  expect(card).toBeDefined();
  expect(JSON.parse(card!.text).patch).toEqual(input.patch);
});
it("preserves a verified price hypothesis form when the final prose invents a number", async () => {
  const { scenarioChatFixture } =
    await import("../../../../scripts/test-price-scenario-fixtures");
  const { buildCopilotResponseMessage } = await import("./response-message");
  const { buildPriceScenarioFormMessages } =
    await import("./price-scenario-messages");
  const { readPriceScenarioQuestion } = await import("@fl-copilot/domain");
  const f = scenarioChatFixture(),
    r = request();
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      priceScenarioForms: [f.state],
      metadata: null,
    }),
  } as CopilotAiProvider;
  const generated = await generateCopilotResponse(provider, r);
  expect(generated.mode).toBe("FALLBACK");
  expect(generated.priceScenarioForms).toEqual([f.state]);
  const message = buildCopilotResponseMessage({
    id: randomUUID(),
    createdAt: f.assistant.createdAt,
    parent: { ...f.chat.message, storeId: r.storeId },
    request: r,
    generation: generated,
  });
  const [card] = buildPriceScenarioFormMessages(
    message,
    generated.priceScenarioForms!,
  );
  expect(readPriceScenarioQuestion(card).state).toEqual(f.state);
  expect(message.text).not.toContain("999");
});
it("keeps a checked identity decision card when only the generated prose fails grounding", async () => {
  const { identityFixture } =
    await import("../../../../scripts/test-identity-review-fixtures");
  const f = identityFixture(),
    r = request();
  const preview = {
    ...f.preview,
    before: {
      product: { ...f.product, storeId: r.storeId },
      entry: { ...f.entry, storeId: r.storeId },
    },
  };
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      identityReviews: [preview],
      metadata: null,
    }),
  } as CopilotAiProvider;
  const generated = await generateCopilotResponse(provider, r);
  expect(generated.mode).toBe("FALLBACK");
  expect(generated.identityReviews).toEqual([preview]);
});
