import { copilotCompletionNotificationSchema } from "@fl-copilot/sync-contracts";
import {
  copilotMessageSchema,
  copilotMessageIsDeleted,
} from "@fl-copilot/domain";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Fixed route from a validated, owned and still-visible local result. Never trust a URL in a push. */
export async function chatNotificationDestination(
  db: OutboxDatabase & AtomicMutationDatabase,
  scope: { ownerId: string; storeId: string },
  raw: unknown,
) {
  const parsed = copilotCompletionNotificationSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.ownerId !== scope.ownerId ||
    parsed.data.storeId !== scope.storeId
  )
    return;
  const data = parsed.data;
  const conversation = await new CopilotConversationRepository(db, scope).get(
    data.conversationId,
  );
  if (!conversation || conversation.status !== "ACTIVE") return;
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND owner_id=? AND store_id=? AND conversation_id=?",
    data.replyId,
    scope.ownerId,
    scope.storeId,
    data.conversationId,
  );
  if (!row) return;
  const message = copilotMessageSchema.parse(JSON.parse(row.payload_json));
  if (
    message.id !== data.replyId ||
    message.ownerId !== scope.ownerId ||
    message.storeId !== scope.storeId ||
    message.conversationId !== data.conversationId ||
    message.role !== "ASSISTANT" ||
    copilotMessageIsDeleted(message, conversation)
  )
    return;
  return {
    pathname: "/(tabs)/copilot" as const,
    params: { conversationId: data.conversationId },
  };
}
