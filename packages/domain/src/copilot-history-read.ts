import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotAttachedSourcesSchema } from "./copilot-attached-sources";
const cursor = z.strictObject({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
export const copilotHistoryReadInputSchema = z.strictObject({
  query: z.string().trim().min(2).max(120).nullable(),
  before: cursor.nullable(),
  limit: z.number().int().min(1).max(5),
});
export const copilotHistoryReadResultSchema = z
  .strictObject({
    messages: z
      .array(
        z.strictObject({
          id: copilotMessageSchema.shape.id,
          role: z.enum(["USER", "ASSISTANT"]),
          text: copilotMessageSchema.shape.text,
          createdAt: copilotMessageSchema.shape.createdAt,
          attachments: copilotMessageSchema.shape.attachments,
        }),
      )
      .max(5),
    hasMore: z.boolean(),
    nextBefore: cursor.nullable(),
    sources: copilotAttachedSourcesSchema,
    sourcesOmitted: z.boolean(),
    // Conversation text is contextual history, never official business evidence.
    evidence: z.array(z.never()).max(0),
  })
  .superRefine((v, ctx) => {
    if (
      v.hasMore !== (v.nextBefore !== null) ||
      v.messages.reduce((sum, m) => sum + m.text.length, 0) > 18000 ||
      new Set(v.messages.map((m) => m.id)).size !== v.messages.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid bounded conversation page",
      });
    }
  });
