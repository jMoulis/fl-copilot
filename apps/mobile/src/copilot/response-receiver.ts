import {
  copilotMessageSchema,
  copilotTurnRequestSchema,
  copilotTurnResultSchema,
  type CopilotTurnRequest,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { applyCopilotRecord } from "./conversation-repository";
/** Accept only the authenticated client's matching reply; no business mutation or new Outbox. */
export async function receiveCopilotReply(
  db: OutboxDatabase & AtomicMutationDatabase,
  scope: { storeId: string; ownerId: string },
  rawRequest: CopilotTurnRequest,
  rawResult: unknown,
) {
  const request = copilotTurnRequestSchema.parse(rawRequest),
    result = copilotTurnResultSchema.parse(rawResult),
    message = result.message;
  if (
    message.role !== "ASSISTANT" ||
    message.id !== request.replyId ||
    message.storeId !== scope.storeId ||
    message.ownerId !== scope.ownerId ||
    message.conversationId !== request.conversationId ||
    message.replyToMessageId !== request.userMessageId
  )
    throw new Error("COPILOT_REPLY_SCOPE_INVALID");
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      request.userMessageId,
      scope.storeId,
      scope.ownerId,
      request.conversationId,
    );
    if (!row) throw new Error("COPILOT_REPLY_PARENT_INVALID");
    const parent = copilotMessageSchema.parse(JSON.parse(row.payload_json));
    if (
      parent.id !== request.userMessageId ||
      parent.storeId !== scope.storeId ||
      parent.ownerId !== scope.ownerId ||
      parent.conversationId !== request.conversationId ||
      parent.role !== "USER" ||
      Date.parse(message.createdAt) < Date.parse(parent.createdAt)
    )
      throw new Error("COPILOT_REPLY_PARENT_INVALID");
    await applyCopilotRecord(tx, scope, "copilot_message", message);
  });
  return message;
}
