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
    version: z.number().int().positive(),
    createdAt: time,
    updatedAt: time,
  })
  .strict()
  .refine(
    (e) => Date.parse(e.updatedAt) >= Date.parse(e.createdAt),
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
    attachments: z.array(copilotAttachmentReferenceSchema).max(10),
    replyToMessageId: id.nullable(),
    supersedesMessageId: id.nullable(),
    version: z.literal(1),
    createdAt: time,
  })
  .strict()
  .superRefine((e, c) => {
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
