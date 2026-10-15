import { createHash } from "node:crypto";
import { z } from "zod";
import {
  copilotMessageSchema,
  knowledgeSuggestionContentSchema,
  knowledgeSuggestionInputSchema,
  validateKnowledgeSuggestionSources,
  suggestionSourcesFromRequest,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { CopilotGenerationRequest } from "./ai-provider";
export function buildKnowledgeSuggestionMessages(
  assistant: CopilotMessage,
  raw: unknown,
  request: CopilotGenerationRequest,
) {
  const suggestions = z.array(knowledgeSuggestionInputSchema).max(1).parse(raw);
  if (!request.memorySuggestion) return [];
  return suggestions.map((raw) => {
    const suggestion = validateKnowledgeSuggestionSources(
      raw,
      request.memorySuggestion!.currentUserMessageId,
      suggestionSourcesFromRequest(request),
    );
    if (
      assistant.replyToMessageId !==
      request.memorySuggestion!.currentUserMessageId
    )
      throw Error("COPILOT_KNOWLEDGE_PROPOSAL_PARENT_INVALID");
    const h = createHash("sha256")
      .update(
        `knowledge-suggestion/${assistant.id}/${JSON.stringify(suggestion)}`,
      )
      .digest("hex");
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    return copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      createdAt: new Date(Date.parse(assistant.createdAt) + 3).toISOString(),
      attachments: [],
      text: JSON.stringify(
        knowledgeSuggestionContentSchema.parse({
          kind: "KNOWLEDGE_SUGGESTION",
          schemaVersion: 1,
          assistantMessageId: assistant.id,
          knowledgeId: id,
          suggestion,
        }),
      ),
    });
  });
}
