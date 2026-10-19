import { analyticsDestinationTableSchema } from "./analytics-destination-table";
import { z } from "zod";
const id = z.string().uuid(),
  time = z.codec(z.string().datetime(), z.string().datetime(), {
    decode: (value) => new Date(value).toISOString(),
    encode: (value) => value,
  });
export const copilotAttachmentReferenceSchema = z
  .object({
    sourceDocumentId: id,
    filename: z.string().trim().min(1).max(240),
    mediaType: z.string().trim().min(1).max(120),
  })
  .strict();
export const copilotConversationSchema = z
  .object({
    id,
    storeId: id,
    ownerId: id,
    title: z.string().trim().min(1).max(120),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    deletedAt: time.optional(),
    deletedMessageIds: z
      .array(id)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    version: z.number().int().positive(),
    createdAt: time,
    updatedAt: time,
  })
  .strict()
  .refine(
    (e) =>
      Date.parse(e.updatedAt) >= Date.parse(e.createdAt) &&
      (!e.deletedAt ||
        (e.status === "ARCHIVED" &&
          Date.parse(e.deletedAt) >= Date.parse(e.createdAt) &&
          Date.parse(e.deletedAt) <= Date.parse(e.updatedAt))),
    "Invalid conversation timestamps",
  );
export const copilotMessageSchema = z
  .object({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    role: z.enum(["USER", "ASSISTANT", "TOOL"]),
    text: z.string().trim().max(16000),
    analyticsDestinations: analyticsDestinationTableSchema.optional(),
    attachments: z.array(copilotAttachmentReferenceSchema).max(10),
    replyToMessageId: id.nullable(),
    supersedesMessageId: id.nullable(),
    version: z.literal(1),
    createdAt: time,
  })
  .strict()
  .superRefine((e, c) => {
    if (e.analyticsDestinations && e.role !== "ASSISTANT")
      c.addIssue({
        code: "custom",
        path: ["analyticsDestinations"],
        message: "Analytical destinations belong to assistant answers",
      });
    if (!e.text && !e.attachments.length)
      c.addIssue({
        code: "custom",
        path: ["text"],
        message: "Message or attachment required",
      });
    if (
      e.attachments.length !==
      new Set(e.attachments.map((a) => a.sourceDocumentId)).size
    )
      c.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "Duplicate attachment",
      });
    if (e.replyToMessageId === e.id || e.supersedesMessageId === e.id)
      c.addIssue({ code: "custom", path: ["id"], message: "Self reference" });
    if (e.role !== "USER" && e.supersedesMessageId)
      c.addIssue({
        code: "custom",
        path: ["supersedesMessageId"],
        message: "Only user messages may be superseded",
      });
  });
export const copilotDraftSchema = z
  .object({
    text: z.string().max(16000),
    attachments: z.array(copilotAttachmentReferenceSchema).max(10),
    updatedAt: time,
  })
  .strict();
export type CopilotConversation = z.infer<typeof copilotConversationSchema>;
export type CopilotMessage = z.infer<typeof copilotMessageSchema>;
export type CopilotDraft = z.infer<typeof copilotDraftSchema>;

/** Logical deletion hides a question's replies and a removed answer's private cards.
 * Immutable business actions and explicitly saved shared memory are independent. */
export function copilotMessageIsDeleted(
  message: CopilotMessage,
  conversation: Pick<CopilotConversation, "deletedAt" | "deletedMessageIds">,
): boolean {
  if (conversation.deletedAt) return true;
  const ids = new Set(conversation.deletedMessageIds ?? []);
  if (
    ids.has(message.id) ||
    (message.replyToMessageId && ids.has(message.replyToMessageId))
  )
    return true;
  if (message.role === "TOOL") {
    try {
      const artifact = JSON.parse(message.text) as {
        assistantMessageId?: string;
      };
      return (
        !!artifact.assistantMessageId && ids.has(artifact.assistantMessageId)
      );
    } catch {
      return false;
    }
  }
  return false;
}

/** Stable business content for source freshness; optional navigation is presentation only. */
export function copilotMessageContent(message: CopilotMessage) {
  const { analyticsDestinations, ...content } = message;
  void analyticsDestinations;
  return content;
}
