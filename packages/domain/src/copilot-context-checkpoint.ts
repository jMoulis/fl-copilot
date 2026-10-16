import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
export const contextNoteSchema = z.strictObject({
  topic: z.enum([
    "GOAL",
    "CONSTRAINT",
    "QUESTION",
    "USER_CONTEXT",
    "ASSISTANT_PROPOSAL",
  ]),
  sourceMessageId: z.string().uuid(),
  quote: z.string().trim().min(1).max(1000),
});
export const contextCheckpointInputSchema = z
  .strictObject({ notes: z.array(contextNoteSchema).min(1).max(8) })
  .refine(
    (v) => v.notes.reduce((sum, n) => sum + n.quote.length, 0) <= 4000,
    "Context quote budget exceeded",
  )
  .refine(
    (v) => JSON.stringify(v).length <= 9000,
    "Encoded context budget exceeded",
  )
  .refine(
    (v) =>
      new Set(v.notes.map((n) => JSON.stringify(n))).size === v.notes.length,
    "Duplicate context note",
  );
export type ContextCheckpointInput = z.infer<
  typeof contextCheckpointInputSchema
>;
export const contextCheckpointContentSchema = z
  .strictObject({
    kind: z.literal("CONTEXT_CHECKPOINT"),
    schemaVersion: z.literal(1),
    assistantMessageId: z.string().uuid(),
    throughUserMessageId: z.string().uuid(),
    throughSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    previousCheckpointId: z.string().uuid().nullable(),
    partial: z.literal(true),
    notes: z
      .array(
        contextNoteSchema.extend({
          sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(8),
    sourceDocumentIds: z.array(z.string().uuid()).max(90),
    sourceReferencesOmitted: z.boolean(),
  })
  .refine(
    (v) =>
      contextCheckpointInputSchema.safeParse({
        notes: v.notes.map((n) => ({
          topic: n.topic,
          sourceMessageId: n.sourceMessageId,
          quote: n.quote,
        })),
      }).success,
    "Invalid compacted context",
  );
export const conversationCheckpointSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("AVAILABLE"),
    checkpointId: z.string().uuid(),
    content: contextCheckpointContentSchema,
  }),
  z.strictObject({ status: z.enum(["ABSENT", "STALE", "UNAVAILABLE"]) }),
]);
/** Preserve a whole paragraph: do not cut a condition, product code or decimal. */
export function validateContextNotes(
  raw: unknown,
  sources: readonly { id: string; role: string; text: string }[],
) {
  const draft = contextCheckpointInputSchema.parse(raw);
  for (const note of draft.notes) {
    const source = sources.find((s) => s.id === note.sourceMessageId);
    if (
      !source ||
      (source.role !== "USER" && source.role !== "ASSISTANT") ||
      (source.role === "ASSISTANT") !== (note.topic === "ASSISTANT_PROPOSAL") ||
      !source.text.split(/\n\s*\n/).some((p) => p.trim() === note.quote)
    )
      throw Error("COPILOT_CONTEXT_QUOTE_INVALID");
  }
  return draft;
}
export function readContextCheckpoint(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  const content = contextCheckpointContentSchema.parse(
    JSON.parse(message.text),
  );
  if (
    message.role !== "TOOL" ||
    message.attachments.length ||
    message.replyToMessageId !== content.throughUserMessageId ||
    message.id === content.assistantMessageId ||
    message.id === content.previousCheckpointId
  )
    throw Error("COPILOT_CONTEXT_RECORD_INVALID");
  return { message, content };
}
/** Ignore note ordering when deciding whether a checkpoint would add information. */
export function contextNotesKey(raw: unknown) {
  return contextCheckpointInputSchema
    .parse(raw)
    .notes.map((n) => JSON.stringify(n))
    .sort()
    .join("\n");
}
export function isContextCheckpointUnchanged(
  content: z.infer<typeof contextCheckpointContentSchema>,
  draft: unknown,
  currentSourceIds: readonly string[],
) {
  return (
    currentSourceIds.every((id) => content.sourceDocumentIds.includes(id)) &&
    contextNotesKey(draft) ===
      contextNotesKey({
        notes: content.notes.map((n) => ({
          topic: n.topic,
          sourceMessageId: n.sourceMessageId,
          quote: n.quote,
        })),
      })
  );
}
