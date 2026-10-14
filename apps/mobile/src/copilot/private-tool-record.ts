import { copilotMessageSchema, type CopilotMessage } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** The synced private TOOL row and its immutable server reply must match the displayed artifact exactly. */
export async function verifyPrivateToolRecord(
  db: OutboxDatabase,
  scope: { storeId: string; ownerId: string },
  message: CopilotMessage,
  assistantId: string,
) {
  if (
    message.role !== "TOOL" ||
    message.storeId !== scope.storeId ||
    message.ownerId !== scope.ownerId
  )
    throw Error("COPILOT_PROPOSAL_SCOPE_INVALID");
  const persisted = await db.getFirstAsync<{
    payload_json: string;
    sync_state: string;
  }>(
    "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    message.id,
    scope.storeId,
    scope.ownerId,
    message.conversationId,
  );
  if (
    !persisted ||
    persisted.sync_state !== "SYNCED" ||
    JSON.stringify(
      copilotMessageSchema.parse(JSON.parse(persisted.payload_json)),
    ) !== JSON.stringify(message)
  )
    throw Error("COPILOT_PROPOSAL_UNAVAILABLE");
  const assistantRow = await db.getFirstAsync<{
    payload_json: string;
    sync_state: string;
  }>(
    "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    assistantId,
    scope.storeId,
    scope.ownerId,
    message.conversationId,
  );
  const assistant = assistantRow
    ? copilotMessageSchema.parse(JSON.parse(assistantRow.payload_json))
    : null;
  if (
    !assistant ||
    assistantRow!.sync_state !== "SYNCED" ||
    assistant.role !== "ASSISTANT" ||
    assistant.id !== assistantId ||
    assistant.storeId !== scope.storeId ||
    assistant.ownerId !== scope.ownerId ||
    assistant.conversationId !== message.conversationId ||
    assistant.replyToMessageId !== message.replyToMessageId ||
    Date.parse(assistant.createdAt) > Date.parse(message.createdAt)
  )
    throw Error("COPILOT_PROPOSAL_PARENT_INVALID");
}
