import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotKnowledgeSchema } from "./copilot-knowledge";
export const knowledgeSuggestionInputSchema = z
  .strictObject({
    statement: copilotKnowledgeSchema.shape.statement,
    sources: z
      .array(
        z.strictObject({
          messageId: z.string().uuid(),
          quote: z.string().trim().min(1).max(600),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine(
    (v) => new Set(v.sources.map((s) => s.messageId)).size === v.sources.length,
    "Duplicate source",
  );
export type KnowledgeSuggestionInput = z.infer<
  typeof knowledgeSuggestionInputSchema
>;
export const knowledgeSuggestionContentSchema = z.strictObject({
  kind: z.literal("KNOWLEDGE_SUGGESTION"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.string().uuid(),
  knowledgeId: z.string().uuid(),
  suggestion: knowledgeSuggestionInputSchema,
});
/** Source quotations establish provenance, never semantic truth or confirmation authority. */
export function validateKnowledgeSuggestionSources(
  raw: unknown,
  currentId: string,
  sources: readonly { id: string; text: string; role: string }[],
) {
  const input = knowledgeSuggestionInputSchema.parse(raw);
  if (!input.sources.some((s) => s.messageId === currentId))
    throw Error("COPILOT_KNOWLEDGE_CURRENT_SOURCE_REQUIRED");
  for (const reference of input.sources) {
    const source = sources.find(
      (s) => s.id === reference.messageId && s.role === "USER",
    );
    if (!source || !source.text.includes(reference.quote))
      throw Error("COPILOT_KNOWLEDGE_QUOTE_INVALID");
  }
  return input;
}
export function readKnowledgeSuggestion(raw: unknown) {
  const message = copilotMessageSchema.parse(raw),
    content = knowledgeSuggestionContentSchema.parse(JSON.parse(message.text));
  if (
    content.knowledgeId !== message.id ||
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length ||
    !content.suggestion.sources.some(
      (s) => s.messageId === message.replyToMessageId,
    )
  )
    throw Error("COPILOT_KNOWLEDGE_PROPOSAL_INVALID");
  return { message, content };
}
export function suggestionSourcesFromRequest(request: {
  userQuestion?: string | null;
  memorySuggestion?: { currentUserMessageId: string };
  history?: { messages: readonly { id: string; text: string; role: string }[] };
}) {
  return [
    ...(request.history?.messages ?? []),
    ...(request.memorySuggestion && request.userQuestion
      ? [
          {
            id: request.memorySuggestion.currentUserMessageId,
            text: request.userQuestion,
            role: "USER",
          },
        ]
      : []),
  ];
}
