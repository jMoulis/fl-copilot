import { CopilotKnowledgeRepository } from "./knowledge-repository";
import {
  readKnowledgeSuggestion,
  copilotMessageSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { verifyPrivateToolRecord } from "./private-tool-record";
/** Recheck the synced proposal and supersession immediately before human confirmation. No writes. */
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

/** Only an explicit human confirmation calls this function; proposal preparation never writes knowledge. */
export async function confirmKnowledgeSuggestion(
  db: OutboxDatabase &
    import("../sync/atomic-local-mutation").AtomicMutationDatabase,
  scope: { storeId: string; ownerId: string },
  proposalId: string,
  statement: string,
  ctx: { commandId: string; deviceId: string; now: string },
) {
  const artifact = await loadKnowledgeSuggestion(db, scope, proposalId),
    repo = new CopilotKnowledgeRepository(db, scope);
  const existing = (await repo.list()).find(
    (e) => e.entity.id === artifact.content.knowledgeId,
  );
  if (existing) return { entity: existing.entity, alreadyApplied: true };
  const entity = {
    id: artifact.content.knowledgeId,
    ...scope,
    scope: "USER_STORE" as const,
    kind: "OPERATING_PRACTICE" as const,
    statement,
    status: "ACTIVE" as const,
    sourceMessageId: artifact.message.replyToMessageId,
    confirmedBy: scope.ownerId,
    version: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  try {
    await repo.save(entity, ctx);
  } catch (error) {
    const raced = (await repo.list()).find((e) => e.entity.id === entity.id);
    if (raced) return { entity: raced.entity, alreadyApplied: true };
    throw error;
  }
  return { entity, alreadyApplied: false };
}
