import { randomUUID } from "node:crypto";
import {
  commercialExecutionChecklist,
  commercialVersionDecisionId,
} from "../packages/commercial-core/src/index";
import {
  commercialExecutionTaskSchema,
  commercialVersionDecisionSchema,
} from "../packages/domain/src/index";
import { commercialConflictBase } from "./test-commercial-conflict-fixtures";
import { makeCommercialChoiceFixture } from "./commercial-choice-fixture-data";
import { receiptReviewDigest } from "./test-receipt-publication-sqlite";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import { applyCommercialVisualReading } from "../apps/mobile/src/commercial/visual-repository";
import { applyCommercialPlanRevision } from "../apps/mobile/src/commercial/week-plan-repository";
import {
  CommercialVersionDecisionRepository,
  applyCommercialVersionDecision,
} from "../apps/mobile/src/commercial/version-decision-repository";
import {
  CommercialExecutionRepository,
  applyCommercialExecution,
} from "../apps/mobile/src/commercial/execution-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export async function nativeCommercialDecisionConflictFixture(
  kind: "COMMERCIAL_REFERENCE" | "COMMERCIAL_EXECUTION",
  path = ":memory:",
  reverse = false,
) {
  const { fixture: f, ...s } = await commercialConflictBase(path),
    { storeId, ownerId, deviceId } = s.scope,
    ctx = { commandId: randomUUID(), deviceId };
  const other = await makeCommercialChoiceFixture(
    { storeId },
    receiptReviewDigest,
    randomUUID,
  );
  other.reading.checksum = "sha256:corrected";
  await applyCommercialVisualReading(s.a, storeId, other.reading);
  await applyCommercialPlanRevision(s.a, storeId, {
    id: f.plan.revisionId,
    storeId,
    plan: f.plan,
    version: 1,
  });
  const sources = (r: typeof f.reading) => ({
    documentId: r.sourceDocumentId,
    checksum: r.checksum,
    readingIds: [r.id],
  });
  const proposals = await commercialExecutionChecklist(
    f.plan,
    receiptReviewDigest,
  );
  let local, remote;
  if (kind === "COMMERCIAL_REFERENCE") {
    const birth = commercialVersionDecisionSchema.parse({
      id: await commercialVersionDecisionId(
        storeId,
        f.sourceDocumentId,
        other.sourceDocumentId,
        receiptReviewDigest,
      ),
      storeId,
      before: sources(f.reading),
      after: sources(other.reading),
      preference: "KEEP_PREVIOUS",
      comparisonReviewed: true,
      note: "",
      version: 1,
      createdAt: f.choice.createdAt,
      updatedAt: f.choice.updatedAt,
    });
    await applyCommercialVersionDecision(s.a, storeId, birth);
    local = commercialVersionDecisionSchema.parse({
      ...birth,
      version: 2,
      note: "Référence locale",
    });
    remote = commercialVersionDecisionSchema.parse({
      ...birth,
      version: 2,
      note: "Référence synchronisée",
      ...(reverse
        ? {
            before: birth.after,
            after: birth.before,
            preference: "KEEP_PREVIOUS",
          }
        : { preference: "PREFER_NEW" }),
    });
    await new CommercialVersionDecisionRepository(
      s.a,
      receiptReviewDigest,
    ).save(local, ctx);
  } else {
    const birth = commercialExecutionTaskSchema.parse({
      ...proposals[0],
      status: "TODO",
      completedAt: null,
      note: "",
      version: 1,
      createdAt: f.plan.validatedAt,
      updatedAt: f.plan.validatedAt,
    });
    await applyCommercialExecution(s.a, storeId, birth);
    local = commercialExecutionTaskSchema.parse({
      ...birth,
      status: "DONE",
      completedAt: "2026-10-10T09:00:00.000Z",
      note: "Affiche imprimée",
      version: 2,
    });
    remote = commercialExecutionTaskSchema.parse({
      ...birth,
      status: "SKIPPED",
      completedAt: null,
      note: "Affiche non disponible",
      version: 2,
    });
    await new CommercialExecutionRepository(s.a, receiptReviewDigest).save(
      local,
      ctx,
    );
  }
  const entityType =
      kind === "COMMERCIAL_REFERENCE"
        ? "commercial_version_decision"
        : "commercial_execution_task",
    table =
      kind === "COMMERCIAL_REFERENCE"
        ? "commercial_version_decisions"
        : "commercial_execution_tasks";
  const command = (await new OutboxRepository(s.a).listPending(storeId)).find(
    (c) => c.entityType === entityType,
  )!;
  const conflict = await new ConflictRepository(s.a).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType,
      entityId: remote.id,
      remoteVersion: remote.version,
      remoteEntity: remote,
    },
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  await s.a.runAsync(
    `UPDATE ${table} SET sync_state='CONFLICT' WHERE id=?`,
    remote.id,
  );
  const preview = storeConflictPreview(kind, remote),
    message = buildStoreConflictMessages(s.f.assistant, [preview])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
  );
  const scope = {
      storeId,
      ownerId,
      deviceId,
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
      canManageCommercialReferences: true,
      canDeclareCommercialExecution: true,
    },
    controller = new CopilotStoreConflictController(
      s.a,
      scope,
      receiptReviewDigest,
      randomUUID,
    );
  return {
    ...s,
    review: {
      kind,
      local,
      remote,
      fixture: f,
      other,
      preview,
      message,
      scope,
      controller,
      conflict,
      entityType,
      table,
      command,
      state: await controller.open(message),
    },
  };
}
