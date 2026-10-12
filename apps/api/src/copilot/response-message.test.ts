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
it("binds assistant identity and parent while rendering canonical numbers", () => {
  const f = fixture();
  const result = buildCopilotResponseMessage(f);
  expect(result).toMatchObject({
    ownerId: f.parent.ownerId,
    conversationId: f.parent.conversationId,
    replyToMessageId: f.parent.id,
    role: "ASSISTANT",
  });
  expect(result.text).toContain("Ventes : 25");
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
