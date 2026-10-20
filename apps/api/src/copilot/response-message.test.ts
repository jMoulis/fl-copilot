import { expect, it } from "vitest";
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
import { copilotMessageSchema } from "@fl-copilot/domain";
import { buildCopilotResponseMessage } from "./response-message";
import { copilotResponseFallback } from "./response-service";
function fixture() {
  const context = detectCopilotConflicts({
    batch: scoreCopilotPriorities({
      storeId: priorityStoreId,
      evaluatedAt: priorityEvaluatedAt,
      candidates: [
        priorityFixture("c", {
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
        }),
      ],
    }),
    intents: [],
  });
  const request = {
    requestId: randomUUID(),
    storeId: priorityStoreId,
    context,
    userQuestion: "Explique les ventes.",
  };
  const parent = copilotMessageSchema.parse({
    id: randomUUID(),
    storeId: priorityStoreId,
    ownerId: randomUUID(),
    conversationId: randomUUID(),
    role: "USER",
    text: request.userQuestion,
    attachments: [],
    replyToMessageId: null,
    supersedesMessageId: null,
    version: 1,
    createdAt: priorityEvaluatedAt,
  });
  return {
    id: randomUUID(),
    createdAt: priorityEvaluatedAt,
    parent,
    request,
    generation: {
      mode: "FALLBACK" as const,
      response: copilotResponseFallback(request),
      metadata: null,
    },
  };
}
it("binds assistant identity and parent without substituting daily figures for a failed chat answer", () => {
  const f = fixture();
  const result = buildCopilotResponseMessage(f);
  expect(result).toMatchObject({
    ownerId: f.parent.ownerId,
    conversationId: f.parent.conversationId,
    replyToMessageId: f.parent.id,
    role: "ASSISTANT",
  });
  expect(result.text).toContain("Je n’ai pas pu terminer cette analyse");
  expect(result.text).not.toContain("Ventes : 25");
  expect(
    buildCopilotResponseMessage({
      ...f,
      generation: {
        ...f.generation,
        response: { ...f.generation.response, summary: "poisoned" },
      },
    }).text,
  ).not.toContain("poisoned");
});
it("rejects foreign scope, wrong parent role, stale timestamp and mismatched question", () => {
  const f = fixture();
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      parent: { ...f.parent, storeId: randomUUID() },
    }),
  ).toThrow("COPILOT_REPLY_SCOPE_INVALID");
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      parent: { ...f.parent, role: "ASSISTANT" },
    }),
  ).toThrow("COPILOT_REPLY_SCOPE_INVALID");
  expect(() =>
    buildCopilotResponseMessage({ ...f, createdAt: "2020-01-01T00:00:00Z" }),
  ).toThrow("COPILOT_REPLY_CONTEXT_INVALID");
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      request: { ...f.request, userQuestion: "Autre question" },
    }),
  ).toThrow("COPILOT_REPLY_CONTEXT_INVALID");
});

it("renders canonical numbers retrieved during generation even when absent from initial context", () => {
  const f = fixture();
  const evidence = {
    id: "queried-day",
    sourceType: "COMPARISON" as const,
    sourceId: "comparison",
    sourceVersion: null,
    label: "Écart de ventes daté (€)",
    value: "25.50",
    factKind: "DERIVED" as const,
  };
  const message = buildCopilotResponseMessage({
    ...f,
    generation: {
      ...f.generation,
      mode: "AI",
      evidence: [evidence],
      response: {
        language: "fr-FR",
        summary: "Voici la comparaison disponible.",
        facts: [{ evidenceId: evidence.id }],
        interpretation: [],
        recommendations: [],
        questions: [],
      },
    },
  });
  expect(message.text).toContain("Écart de ventes daté (€) : 25.50");
});

it("attaches only cited server-resolved original PDF references, never a model URL", () => {
  const f = fixture(),
    sourceId = randomUUID(),
    otherId = randomUUID();
  const evidence = [
    {
      id: "commercial-pdf-source/test",
      sourceType: "SOURCE_DOCUMENT" as const,
      sourceId,
      sourceVersion: null,
      label: "PDF original",
      value: "pense-bete.pdf",
      factKind: "QUALITY" as const,
    },
    {
      id: "pdf-price",
      sourceType: "SOURCE_DOCUMENT" as const,
      sourceId,
      sourceVersion: 1,
      label: "Prix enseigne à confirmer",
      value: "2,20€",
      factKind: "SOURCE_INSTRUCTION" as const,
    },
    {
      id: "commercial-pdf-source/other",
      sourceType: "SOURCE_DOCUMENT" as const,
      sourceId: otherId,
      sourceVersion: null,
      label: "Autre PDF",
      value: "other.pdf",
      factKind: "QUALITY" as const,
    },
  ];
  const response = {
    language: "fr-FR" as const,
    summary: "La source précise un prix à confirmer.",
    facts: [{ evidenceId: "pdf-price" }],
    interpretation: [],
    recommendations: [],
    questions: [],
  };
  const result = buildCopilotResponseMessage({
    ...f,
    generation: { mode: "AI", metadata: null, response, evidence },
  });
  expect(result.attachments).toEqual([
    {
      sourceDocumentId: sourceId,
      filename: "pense-bete.pdf",
      mediaType: "application/pdf",
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("https://");
  expect(result.text).toContain("2,20€");
});
it("keeps the model's conversational Markdown without appending a diagnostic report", () => {
  const f = fixture();
  const result = buildCopilotResponseMessage({
    ...f,
    generation: {
      ...f.generation,
      mode: "AI",
      response: {
        language: "fr-FR",
        summary: "Voici le bilan.",
        facts: [{ evidenceId: "sales" }],
        interpretation: [],
        recommendations: [],
        questions: [],
        narrative:
          "Voici les ventes : **{{value:0}} €**. {{source:0}}\n\nQue veux-tu approfondir ?",
      },
    },
  });
  expect(result.text).toContain("**25 €**");
  expect(result.text).toContain("[Source](copilot-source:");
  expect(result.text).not.toMatch(
    /Faits disponibles|Confiance :|Lecture\n|Suivi :/,
  );
});

it("keeps both cited comparison originals available without embedding private download URLs", () => {
  const f = fixture(),
    ids = [randomUUID(), randomUUID()],
    evidence = ids.map((id, i) => ({
      id: `commercial-pdf-source/comparison-${i}`,
      sourceType: "SOURCE_DOCUMENT" as const,
      sourceId: id,
      sourceVersion: null,
      label: "PDF original",
      value: i ? "corrige.pdf" : "original.pdf",
      factKind: "QUALITY" as const,
    }));
  const message = buildCopilotResponseMessage({
    ...f,
    generation: {
      mode: "AI",
      metadata: null,
      evidence,
      response: {
        language: "fr-FR",
        summary: "Voici les sources de la comparaison.",
        facts: evidence.map((e) => ({ evidenceId: e.id })),
        interpretation: [],
        recommendations: [],
        questions: [],
      },
    },
  });
  expect(message.attachments.map((a) => a.sourceDocumentId)).toEqual(ids);
  expect(message.attachments.map((a) => a.filename)).toEqual([
    "original.pdf",
    "corrige.pdf",
  ]);
  expect(JSON.stringify(message)).not.toContain("https://");
});

it("preserves the deterministic no-question brief outside the chat", () => {
  const f = fixture();
  const message = buildCopilotResponseMessage({
    ...f,
    request: { ...f.request, userQuestion: null },
  });
  expect(message.text).toContain("Ventes : 25");
});

it("persists compact destinations only when negotiated, retaining canonical facts and actor binding", async () => {
  const { largeAnalyticalContext } =
    await import("../../../../scripts/test-analytics-destination-fixtures");
  const f = fixture();
  const evidence = {
    id: "long",
    sourceType: "KPI" as const,
    sourceId: "canonical",
    sourceVersion: null,
    label: "CA",
    value: "25.50",
    factKind: "DERIVED" as const,
    analyticsContext: largeAnalyticalContext(),
  };
  const input = {
    ...f,
    generation: {
      ...f.generation,
      mode: "AI" as const,
      evidence: [evidence],
      response: {
        language: "fr-FR" as const,
        summary: "Voici le bilan.",
        narrative: "Le CA renseigné est {{value:0}} € {{source:0}}.",
        facts: [{ evidenceId: "long" }],
        interpretation: [],
        recommendations: [],
        questions: [],
      },
    },
  };
  const modern = buildCopilotResponseMessage({
    ...input,
    supportsAnalyticsDestinations: true,
  });
  expect(modern.analyticsDestinations!.targets).toHaveLength(1);
  expect(modern.text).toContain("25,50 €");
  expect(
    buildCopilotResponseMessage(input).analyticsDestinations,
  ).toBeUndefined();
  expect(modern.ownerId).toBe(f.parent.ownerId);
});

it("keeps the initial request limit and rejects conflicting or oversized completed evidence", () => {
  const f = fixture();
  const evidence = Array.from({ length: 100 }, (_, index) => ({
    id: `completed-${index}`,
    sourceType: "KPI" as const,
    sourceId: "daily",
    sourceVersion: 1,
    label: "Ventes",
    value: index,
    factKind: "OBSERVED" as const,
  }));
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      request: {
        ...f.request,
        evidence: [...evidence, { ...evidence[0]!, id: "overflow" }],
      },
    }),
  ).toThrow();
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      request: { ...f.request, evidence },
      generation: {
        ...f.generation,
        evidence: [{ ...evidence[0]!, value: -1 }],
      },
    }),
  ).toThrow("AMBIGUOUS_EVIDENCE");
  expect(() =>
    buildCopilotResponseMessage({
      ...f,
      generation: {
        ...f.generation,
        evidence: Array.from({ length: 1306 }, (_, index) => ({
          ...evidence[0]!,
          id: `overflow-${index}`,
        })),
      },
    }),
  ).toThrow("COPILOT_AI_INPUT_INVALID");
});
