import { randomUUID } from "node:crypto";
import { copilotKnowledgeSchema } from "../packages/domain/src/index";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import {
  CopilotKnowledgeRepository,
  applyKnowledgeRecord,
} from "../apps/mobile/src/copilot/knowledge-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
export async function nativeKnowledgeConflictFixture(
  path = ":memory:",
  forgotten?: "LOCAL" | "REMOTE",
) {
  const s = await nativeReceiptPublicationFixture(path),
    { storeId, ownerId, deviceId } = s.scope,
    scope = { storeId, ownerId },
    repo = new CopilotKnowledgeRepository(s.a, scope, receiptReviewDigest),
    initial = copilotKnowledgeSchema.parse({
      id: randomUUID(),
      storeId,
      ownerId,
      scope: "USER_STORE",
      kind: "OPERATING_PRACTICE",
      statement: "Pratique initiale",
      status: "ACTIVE",
      sourceMessageId: null,
      confirmedBy: ownerId,
      version: 1,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
    });
  await repo.save(initial, { deviceId, commandId: randomUUID() });
  await applyKnowledgeRecord(s.a, scope, initial, 1);
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='ACKNOWLEDGED' WHERE entity_type='copilot_knowledge'",
  );
  const local = copilotKnowledgeSchema.parse({
      ...initial,
      version: 2,
      status: forgotten === "LOCAL" ? "FORGOTTEN" : "ACTIVE",
      statement: forgotten === "LOCAL" ? "Oublié" : "Pratique locale",
    }),
    remote = copilotKnowledgeSchema.parse({
      ...initial,
      version: 2,
      status: forgotten === "REMOTE" ? "FORGOTTEN" : "ACTIVE",
      statement: forgotten === "REMOTE" ? "Oublié" : "Pratique synchronisée",
    });
  await repo.save(local, { deviceId, commandId: randomUUID() });
  await applyKnowledgeRecord(s.a, scope, remote);
  const command = (await new OutboxRepository(s.a).listPending(storeId)).find(
    (c) => c.entityType === "copilot_knowledge",
  )!;
  const conflict = await new ConflictRepository(s.a).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: initial.id,
      remoteVersion: 2,
      remoteEntity: remote,
    },
  );
  await s.a.runAsync(
    "UPDATE copilot_knowledge SET sync_state='CONFLICT' WHERE id=?",
    initial.id,
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  return {
    ...s,
    review: {
      kind: "KNOWLEDGE" as const,
      table: "copilot_knowledge",
      entityType: "copilot_knowledge",
      scope,
      repo,
      local,
      remote,
      command,
      conflict,
    },
  };
}
