import {
  copilotMessageSchema,
  CopilotToolError,
  type CopilotFormDefinition,
  type CopilotToolScope,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** New unrelated messages do not invalidate a postponed question; explicit supersession does. */
export async function informationQuestionBasis(
  db: OutboxDatabase,
  scope: CopilotToolScope,
  definition: CopilotFormDefinition,
) {
  const parent = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    definition.parentUserMessageId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  const user = parent
    ? copilotMessageSchema.parse(JSON.parse(parent.payload_json))
    : null;
  if (
    !user ||
    user.role !== "USER" ||
    user.id !== definition.parentUserMessageId ||
    user.storeId !== scope.storeId ||
    user.ownerId !== scope.ownerId ||
    user.conversationId !== scope.conversationId
  )
    throw new CopilotToolError("FORBIDDEN");
  const newer = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(payload_json,'$.role')='USER' AND json_extract(payload_json,'$.supersedesMessageId')=? LIMIT 1",
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
    user.id,
  );
  return newer ? "changed/question-superseded" : definition.basisToken;
}
