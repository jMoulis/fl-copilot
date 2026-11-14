import {
  readKnowledgeSuggestion,
  copilotMessageSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { verifyPrivateToolRecord } from "./private-tool-record";
/** Recheck the synced proposal and supersession before manual or delegated automatic recording. No writes. */
export async function loadKnowledgeSuggestion(
  db: OutboxDatabase,
  scope: { storeId: string; ownerId: string },
  id: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
  if (!row) throw Error("COPILOT_KNOWLEDGE_PROPOSAL_UNAVAILABLE");
  const artifact = readKnowledgeSuggestion(
    copilotMessageSchema.parse(JSON.parse(row.payload_json)),
  );
  if (artifact.message.id !== id)
    throw Error("COPILOT_KNOWLEDGE_PROPOSAL_INVALID");
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  for (const reference of artifact.content.suggestion.sources) {
    const corrected = await db.getFirstAsync(
      "SELECT id FROM copilot_messages WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(payload_json,'$.role')='USER' AND json_extract(payload_json,'$.supersedesMessageId')=? LIMIT 1",
      scope.storeId,
      scope.ownerId,
      artifact.message.conversationId,
      reference.messageId,
    );
    if (corrected) throw Error("COPILOT_KNOWLEDGE_SOURCE_SUPERSEDED");
  }
  return artifact;
}
