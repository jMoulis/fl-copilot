import { randomUUID } from "node:crypto";
import {
  copilotMessageSchema,
  executionLinkPreviewSchema,
} from "../packages/domain/src/index";
import {
  decisionFixture,
  decisionNativeFixture,
  saveDecision,
  decisionDigest,
} from "./test-copilot-decision-fixtures";
import { actionReviewFixture } from "./test-action-review-fixtures";
import { applyDecisionRecord } from "../apps/mobile/src/copilot/decision-repository";
import { applyCommercialPlan } from "../apps/mobile/src/commercial/week-plan-repository";
import { applyCommercialExecution } from "../apps/mobile/src/commercial/execution-repository";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { CopilotExecutionLinkRepository } from "../apps/mobile/src/copilot/execution-link-repository";
import { buildExecutionLinkMessages } from "../apps/api/src/copilot/execution-link-messages";
import { MercalysTestDatabase } from "./test-mercalys-sync-fixtures";
export async function executionLinkFixture(db = new MercalysTestDatabase()) {
  const business = await actionReviewFixture(),
    n = await decisionNativeFixture(
      decisionFixture({ storeId: business.storeId }),
      db,
    );
  const decision = (await saveDecision(n, "MODIFY")).decision!;
  await applyDecisionRecord(db, n.scope, decision, decision.version);
  for (const c of await new OutboxRepository(db).listPending(n.storeId)) {
    await new OutboxRepository(db).markSyncing(c.commandId);
    await new OutboxRepository(db).markAcknowledged(c.commandId);
  }
  await applyCommercialPlan(db, n.storeId, business.plan);
  await applyCommercialExecution(db, n.storeId, business.task);
  const request = copilotMessageSchema.parse({
    ...n.request,
    id: randomUUID(),
    createdAt: "2026-10-18T12:00:01.000Z",
    text: "Relie mon choix à cette déclaration.",
  });
  const assistant = copilotMessageSchema.parse({
    ...request,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: request.id,
    createdAt: "2026-10-18T12:00:02.000Z",
    text: "L’association est prête à être confirmée.",
  });
  const input = {
    recommendationId: decision.id,
    decisionVersion: decision.version,
    weekStart: business.plan.weekStart,
    taskId: business.task.id,
    taskVersion: business.task.version,
  };
  const preview = executionLinkPreviewSchema.parse({
    input,
    status: "READY",
    snapshot: {
      decision: {
        id: decision.id,
        version: decision.version,
        conversationId: decision.conversationId,
        revision: decision.revisions.at(-1),
        basis: n.preview.basis,
      },
      weekStart: input.weekStart,
      task: business.task,
    },
    evidence: [
      {
        id: "link-fixture",
        sourceType: "DATA_QUALITY",
        sourceId: business.task.id,
        sourceVersion: 1,
        label: "Lien à confirmer",
        value: "Aucun lien n’est encore enregistré.",
        factKind: "QUALITY",
      },
    ],
  });
  const card = buildExecutionLinkMessages(assistant, [preview])[0]!;
  for (const m of [request, assistant, card])
    await applyCopilotRecord(db, n.scope, "copilot_message", m);
  const scope = { ...n.scope, canLink: true };
  const repository = new CopilotExecutionLinkRepository(
    db,
    scope,
    decisionDigest,
    randomUUID,
    () => "2026-10-18T12:00:10.000Z",
  );
  return {
    ...n,
    business,
    decision,
    input,
    preview,
    linkRequest: request,
    linkAssistant: assistant,
    linkCard: card,
    repository,
    linkScope: scope,
  };
}
