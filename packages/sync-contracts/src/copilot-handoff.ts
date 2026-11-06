import {
  copilotTurnRequestSchema,
  copilotConversationCommandSchema,
  copilotMessageSchema,
} from "@fl-copilot/domain";
import { syncPushRequestSchema } from "./sync";

/** Optional canonical Outbox intake in the same HTTP request as generation. */
export const copilotTurnTransportRequestSchema = copilotTurnRequestSchema
  .extend({
    synchronization: syncPushRequestSchema.optional(),
  })
  .superRefine((input, context) => {
    const packet = input.synchronization;
    if (!packet) return;
    if (
      !packet.commands.length ||
      !packet.commands.every((command) => {
        if (
          command.type === "COPILOT_CONVERSATION_UPSERT" &&
          command.entityType === "copilot_conversation" &&
          command.entityId === input.conversationId
        ) {
          const value = copilotConversationCommandSchema.safeParse(
            command.payload,
          );
          return (
            value.success &&
            value.data.id === input.conversationId &&
            value.data.storeId === packet.storeId &&
            value.data.status === "ACTIVE"
          );
        }
        if (
          command.type === "COPILOT_MESSAGE_APPEND" &&
          command.entityType === "copilot_message" &&
          command.entityId === input.userMessageId
        ) {
          const value = copilotMessageSchema.safeParse(command.payload);
          return (
            value.success &&
            value.data.id === input.userMessageId &&
            value.data.conversationId === input.conversationId &&
            value.data.storeId === packet.storeId &&
            value.data.role === "USER" &&
            value.data.attachments.length === 0
          );
        }
        return false;
      })
    )
      context.addIssue({
        code: "custom",
        path: ["synchronization"],
        message:
          "Only this plain question and its conversation may be handed off.",
      });
  });
