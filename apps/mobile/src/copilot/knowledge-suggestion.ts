import {
  CopilotKnowledgeRepository,
  normalizeKnowledgeStatement,
} from "./knowledge-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { loadKnowledgeSuggestion } from "./knowledge-suggestion-source";
export { loadKnowledgeSuggestion } from "./knowledge-suggestion-source";
/** Called by explicit review or by the enabled automatic-capture worker after source checks. */
export async function confirmKnowledgeSuggestion(
  db: OutboxDatabase &
    import("../sync/atomic-local-mutation").AtomicMutationDatabase,
  scope: { storeId: string; ownerId: string },
  proposalId: string,
  statement: string,
  ctx: {
    commandId: string;
    deviceId: string;
    now: string;
    captureMode?: "AUTOMATIC";
    canWrite?: () => boolean;
  },
) {
  const artifact = await loadKnowledgeSuggestion(db, scope, proposalId),
    repo = new CopilotKnowledgeRepository(db, scope);
  const normalize = normalizeKnowledgeStatement;
  const existing = (await repo.list()).find(
    (e) =>
      e.entity.id === artifact.content.knowledgeId ||
      (ctx.captureMode === "AUTOMATIC" &&
        e.entity.status === "ACTIVE" &&
        normalize(e.entity.statement) === normalize(statement)),
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
    ...(ctx.captureMode ? { captureMode: ctx.captureMode } : {}),
    version: 1,
    createdAt:
      ctx.captureMode === "AUTOMATIC" ? artifact.message.createdAt : ctx.now,
    updatedAt:
      ctx.captureMode === "AUTOMATIC" ? artifact.message.createdAt : ctx.now,
  };
  try {
    await repo.save(entity, { ...ctx, proposalId });
  } catch (error) {
    const raced = (await repo.list()).find(
      (e) =>
        e.entity.id === entity.id ||
        (ctx.captureMode === "AUTOMATIC" &&
          e.entity.status === "ACTIVE" &&
          normalize(e.entity.statement) === normalize(statement)),
    );
    if (raced) return { entity: raced.entity, alreadyApplied: true };
    throw error;
  }
  return { entity, alreadyApplied: false };
}
