import { z } from "zod";

export const expoPushTokenSchema = z
  .string()
  .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{16,200}\]$/);
/** Device/session delivery preference, never a store business mutation. */
export const devicePushTokenRequestSchema = z
  .object({
    storeId: z.string().uuid(),
    pushToken: expoPushTokenSchema.nullable(),
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
