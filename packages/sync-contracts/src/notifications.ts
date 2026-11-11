import { z } from "zod";

export const expoPushTokenSchema = z
  .string()
  .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{16,200}\]$/);
export const pushChannelsSchema = z.strictObject({
  chat: z.boolean(),
  email: z.boolean(),
  documents: z.boolean().optional(),
});
export type PushChannels = z.infer<typeof pushChannelsSchema>;
/** Device/session delivery preference, never a store business mutation. */
export const devicePushTokenRequestSchema = z
  .object({
    storeId: z.string().uuid(),
    pushToken: expoPushTokenSchema.nullable(),
    channels: pushChannelsSchema.optional(),
  })
  .strict();
export const devicePushTokenResponseSchema = z.object({ enabled: z.boolean() });
export const copilotCompletionNotificationSchema = z
  .object({
    kind: z.literal("COPILOT_REPLY_READY"),
    ownerId: z.string().uuid(),
    storeId: z.string().uuid(),
    conversationId: z.string().uuid(),
    replyId: z.string().uuid(),
  })
  .strict();
export type CopilotCompletionNotification = z.infer<
  typeof copilotCompletionNotificationSchema
>;
/** Opens the store inbox only; never confirms a document or starts its import. */
export const emailReadyNotificationSchema = z.strictObject({
  kind: z.literal("STORE_EMAIL_READY"),
  ownerId: z.string().uuid(),
  storeId: z.string().uuid(),
  receiptId: z.string().uuid(),
});

/** Processing result only; never publishes business observations. */
export const documentReadyNotificationSchema = z.strictObject({
  kind: z.literal("SOURCE_DOCUMENT_READY"),
  resultKey: z.string().regex(/^[a-f0-9]{64}$/),
  ownerId: z.string().uuid(),
  storeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  sourceType: z.enum(["WEEKLY_COMMERCIAL_PDF", "WASTE_RECEIPT"]),
});
