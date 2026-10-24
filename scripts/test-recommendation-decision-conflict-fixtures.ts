import { DatabaseSync } from "node:sqlite";
import {
  decisionNativeFixture,
  decisionFixture,
  saveDecision,
  decisionChoiceFixture,
} from "./test-copilot-decision-fixtures";
import { ReceiptTestDatabase } from "./test-receipt-publication-sqlite";
import { applyDecisionRecord } from "../apps/mobile/src/copilot/decision-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { recommendationDecisionSchema } from "../packages/domain/src/index";
export async function nativeRecommendationDecisionConflictFixture(
  path = ":memory:",
) {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    f = await decisionNativeFixture(decisionFixture(), a);
  await saveDecision(f, "ACCEPT");
  const local = (await saveDecision(f, "MODIFY")).decision!,
    remote = recommendationDecisionSchema.parse({
      ...local,
      version: 1,
      revisions: [
        { ...local.revisions[0]!, ...decisionChoiceFixture("REJECT") },
      ],
      updatedAt: local.revisions[0]!.decidedAt,
    });
  await applyDecisionRecord(a, f.scope, remote);
  const command = (await new OutboxRepository(a).listPending(f.storeId))[0]!,
    conflict = await new ConflictRepository(a).recordPushConflict(command, {
      commandId: command.commandId,
      entityType: "copilot_decision",
      entityId: f.recommendationId,
      status: "CONFLICT",
      remoteEntity: remote,
      remoteVersion: 1,
    });
  await a.runAsync(
    "UPDATE copilot_decisions SET sync_state='CONFLICT' WHERE id=?",
    f.recommendationId,
  );
  await a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  return {
    db,
    a,
    f,
    scope: f.scope,
    count,
    review: {
      kind: "RECOMMENDATION" as const,
      local,
      remote,
      repo: f.repo,
      command,
      conflict,
    },
  };
}
