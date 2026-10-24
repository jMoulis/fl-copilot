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
  type CopilotGenerationFailure,
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
it("preserves the separate native receipt review when only the generated narrative fails grounding", async () => {
  const { receiptPublicationChatFixture } =
    await import("../../../../scripts/test-receipt-publication-fixtures");
  const f = receiptPublicationChatFixture(),
    r = request(),
    preview = { ...f.preview, source: { ...f.source, storeId: r.storeId } };
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      receiptPublicationPreviews: [preview],
      metadata: null,
    }),
  } as CopilotAiProvider;
  const generated = await generateCopilotResponse(provider, r);
  expect(generated.mode).toBe("FALLBACK");
  expect(generated.receiptPublicationPreviews).toEqual([preview]);
});
it("retains a verified correction review card when only the generated narrative fails grounding", async () => {
  const { receiptCorrectionFixture } =
    await import("../../../../scripts/test-receipt-correction-fixtures");
  const f = receiptCorrectionFixture(),
    r = request(),
    preview = { ...f.preview, source: { ...f.source, storeId: r.storeId } };
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, summary: "999 euros" },
      receiptCorrectionPreviews: [preview],
      metadata: null,
    }),
  } as CopilotAiProvider;
  const generated = await generateCopilotResponse(provider, r);
  expect(generated.mode).toBe("FALLBACK");
  expect(generated.receiptCorrectionPreviews).toEqual([preview]);
});

it.each([
  "COPILOT_AI_TIMEOUT",
  "COPILOT_AI_RATE_LIMITED",
  "COPILOT_AI_CONFIGURATION_REQUIRED",
  "COPILOT_AI_OUTPUT_INVALID",
  "COPILOT_AI_OUTPUT_LIMIT",
] as const)(
  "reports %s once without leaking provider text or replacing the requested periods",
  async (code) => {
    const error = new CopilotAiError(
      code,
      code.endsWith("TIMEOUT") || code.endsWith("RATE_LIMITED"),
    );
    error.message = "private provider response, credentials and document text";
    const provider = {
      model: "test",
      generate: vi.fn().mockRejectedValue(error),
    } as CopilotAiProvider;
    const r = {
      ...request(),
      userQuestion: "Analyse les ventes de novembre 2024 et 2025.",
    };
    const onFailure = vi.fn();
    const result = await generateCopilotResponse(
      provider,
      r,
      undefined,
      undefined,
      undefined,
      onFailure,
    );
    expect(result.mode).toBe("FALLBACK");
    expect(result.response.facts).toEqual([]);
    expect(result.response.recommendations).toEqual([]);
    expect(result.response.summary).toContain(
      code === "COPILOT_AI_OUTPUT_LIMIT" ? "synthèse" : "réessayer",
    );
    if (code === "COPILOT_AI_OUTPUT_LIMIT")
      expect(result.response.summary).not.toContain("réessayer");
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      requestId: r.requestId,
      kind: "GENERATION",
      code,
      retryable: error.retryable,
      durationMs: expect.any(Number),
    });
    expect(onFailure.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify([result, onFailure.mock.calls])).not.toContain(
      error.message,
    );
    expect(JSON.stringify(result)).not.toContain(code);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  },
);
it("distinguishes failed grounding after partial progress from provider unavailability", async () => {
  const provider = {
    model: "test",
    generate: vi.fn(
      async (...args: Parameters<CopilotAiProvider["generate"]>) => {
        const progress = args[3];
        progress?.(
          { narrative: "La comparaison est en cours.", facts: [] },
          [],
        );
        return {
          output: { ...answer, narrative: "Le total est 999 euros." },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "mock",
            inputTokens: null,
            outputTokens: null,
          },
        };
      },
    ),
  } as CopilotAiProvider;
  const onFailure = vi.fn(),
    progress = vi.fn();
  const result = await generateCopilotResponse(
    provider,
    { ...request(), userQuestion: "Compare novembre 2024 et 2025" },
    undefined,
    progress,
    undefined,
    onFailure,
  );
  expect(progress).toHaveBeenCalled();
  expect(onFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "GROUNDING",
      code: "UNSUPPORTED_NUMBER",
      retryable: false,
    }),
  );
  expect(result.response.facts).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("999");
});
it("does not turn successful generation, cancellation or unexpected bugs into reported fallbacks", async () => {
  const onFailure = vi.fn();
  const provider = {
    model: "test",
    generate: vi.fn().mockResolvedValue({ output: answer, metadata: null }),
  } as CopilotAiProvider;
  expect(
    (
      await generateCopilotResponse(
        provider,
        request(),
        undefined,
        undefined,
        undefined,
        onFailure,
      )
    ).mode,
  ).toBe("AI");
  for (const error of [
    new CopilotAiError("COPILOT_AI_CANCELLED", false),
    new Error("unexpected"),
  ]) {
    vi.mocked(provider.generate).mockRejectedValueOnce(error);
    await expect(
      generateCopilotResponse(
        provider,
        request(),
        undefined,
        undefined,
        undefined,
        onFailure,
      ),
    ).rejects.toThrow();
  }
  expect(onFailure).not.toHaveBeenCalled();
});
it("saves a safe answer even when the diagnostics sink fails", async () => {
  const provider = {
    model: "test",
    generate: vi
      .fn()
      .mockRejectedValue(new CopilotAiError("COPILOT_AI_TIMEOUT", true)),
  } as CopilotAiProvider;
  const result = await generateCopilotResponse(
    provider,
    { ...request(), userQuestion: "Compare les ventes" },
    undefined,
    undefined,
    undefined,
    () => {
      throw new Error("sink unavailable");
    },
  );
  expect(result.mode).toBe("FALLBACK");
  expect(result.response.facts).toEqual([]);
});
it("does not present the latest daily snapshot for an attachment-only request", async () => {
  const provider = {
    model: "test",
    generate: vi
      .fn()
      .mockRejectedValue(new CopilotAiError("COPILOT_AI_UNAVAILABLE", true)),
  } as CopilotAiProvider;
  const r = {
    ...request(),
    attachedSources: [
      {
        sourceDocumentId: randomUUID(),
        filename: "novembre.pdf",
        mediaType: "application/pdf",
        sourceType: "WEEKLY_COMMERCIAL_PDF" as const,
        status: "PENDING_UPLOAD" as const,
        registeredAt: priorityEvaluatedAt,
      },
    ],
  };
  const failures: CopilotGenerationFailure[] = [];
  const result = await generateCopilotResponse(
    provider,
    r,
    undefined,
    undefined,
    undefined,
    (f) => failures.push(f),
  );
  expect(result.response.facts).toEqual([]);
  expect(failures).toHaveLength(1);
});

it("keeps a valid analytical answer when a tool returns its supported 241 facts", async () => {
  const r = request();
  const facts = Array.from({ length: 241 }, (_, index) => ({
    id: `query-fact-${index}`,
    sourceType: "KPI" as const,
    sourceId: "analytical-query",
    sourceVersion: 1,
    label: "Montant renseigné",
    value: index,
    factKind: "OBSERVED" as const,
  }));
  const provider = {
    model: "fixture",
    generate: vi.fn().mockResolvedValue({
      output: {
        ...answer,
        facts: [{ evidenceId: facts[0]!.id }, { evidenceId: facts[240]!.id }],
      },
      toolEvidence: facts,
      metadata: {
        requestedModel: "fixture",
        resolvedModel: "fixture",
        responseId: "fixture",
      },
    }),
  } as CopilotAiProvider;
  const result = await generateCopilotResponse(provider, r);
  expect(result.mode).toBe("AI");
  expect(result.response.facts).toEqual([
    { evidenceId: facts[0]!.id },
    { evidenceId: facts[240]!.id },
  ]);
  expect(result.evidence).toHaveLength(241);
});

it("deduplicates overlapping initial and tool facts without relaxing initial input limits", async () => {
  const r = request();
  const fact = r.context.batch.candidates[0]!.evidence[0]!;
  r.evidence = Array.from({ length: 100 }, (_, i) => ({
    ...fact,
    id: `initial-${i}`,
  }));
  const provider = {
    model: "fixture",
    generate: vi.fn().mockResolvedValue({
      output: { ...answer, facts: [{ evidenceId: "initial-0" }] },
      toolEvidence: [r.evidence[0]!],
      metadata: null,
    }),
  } as CopilotAiProvider;
  const result = await generateCopilotResponse(provider, r);
  expect(result.mode).toBe("AI");
  expect(result.evidence).toHaveLength(100);
  provider.generate = vi.fn();
  await expect(
    generateCopilotResponse(provider, {
      ...r,
      evidence: [...r.evidence, { ...fact, id: "extra" }],
    }),
  ).rejects.toThrow();
  expect(provider.generate).not.toHaveBeenCalled();
});

it("refuses invalid, oversized or conflicting completed facts instead of trusting the model", async () => {
  const { COPILOT_TOOL_EVIDENCE_LIMIT } = await import("./generation-limits");
  const r = request(),
    fact = r.context.batch.candidates[0]!.evidence[0]!;
  r.evidence = [fact];
  for (const [toolEvidence, code] of [
    [[{ ...fact, value: 99 }], "AMBIGUOUS_EVIDENCE"],
    [[{ ...fact, sourceVersion: -1 }], "COPILOT_AI_INPUT_INVALID"],
    [
      Array.from({ length: COPILOT_TOOL_EVIDENCE_LIMIT + 1 }, (_, i) => ({
        ...fact,
        id: `excess-${i}`,
      })),
      "COPILOT_AI_INPUT_INVALID",
    ],
  ] as const) {
    const failures: CopilotGenerationFailure[] = [];
    const provider = {
      model: "fixture",
      generate: vi
        .fn()
        .mockResolvedValue({ output: answer, toolEvidence, metadata: null }),
    } as CopilotAiProvider;
    const result = await generateCopilotResponse(
      provider,
      r,
      undefined,
      undefined,
      undefined,
      (f) => failures.push(f),
    );
    expect(result.mode).toBe("FALLBACK");
    expect(result.evidence).toEqual([fact]);
    expect(failures[0]?.code).toBe(code);
  }
});

it("finalizes the streamed long answer that formerly failed after generation, without oversized provisional snapshots", async () => {
  const { longCopilotAnswerFixture } =
    await import("../../../../scripts/test-copilot-long-answer-fixtures");
  const { chatFixture } =
    await import("../../../../scripts/test-chat-fixtures");
  const { buildCopilotResponseMessage } = await import("./response-message");
  const { copilotMessageSchema } = await import("@fl-copilot/domain");
  const f = longCopilotAnswerFixture(),
    r = request(),
    chat = chatFixture(randomUUID),
    progress = vi.fn();
  const provider = {
    model: "test",
    generate: vi.fn(async (_r, _schema, _signal, onProgress) => {
      onProgress?.(f.output, f.evidence);
      return {
        output: f.output,
        toolEvidence: f.evidence,
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-long-answer",
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    }),
  } as CopilotAiProvider;
  const generation = await generateCopilotResponse(
    provider,
    r,
    undefined,
    progress,
  );
  expect(generation.mode).toBe("AI");
  expect(progress).toHaveBeenCalled();
  expect(progress.mock.lastCall![0]).toContain("23,25 €");
  expect(progress.mock.calls.every(([text]) => text.length <= 16000)).toBe(
    true,
  );
  const message = buildCopilotResponseMessage({
    id: randomUUID(),
    createdAt: chat.message.createdAt,
    parent: { ...chat.message, storeId: r.storeId, attachments: [] },
    request: r,
    generation,
  });
  expect(copilotMessageSchema.parse(message).answerSources).toHaveLength(
    f.evidence.length,
  );
  expect(message.text).toContain("23,25 €");
  expect(message.text).not.toContain("momentanément indisponible");
  expect(provider.generate).toHaveBeenCalledTimes(1);
});
