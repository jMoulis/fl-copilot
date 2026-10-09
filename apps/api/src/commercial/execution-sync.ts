import { createHash } from "node:crypto";
import {
  commercialExecutionTaskSchema,
  type CommercialExecutionTask,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialExecutionTaskId,
  commercialExecutionSameIdentity,
  commercialExecutionSameTarget,
} from "@fl-copilot/commercial-core";
import { commercialExecutionChecklist } from "@fl-copilot/commercial-core";
import {
  serializeCommercialPlanRevision,
  type PlanRevisionDocument,
} from "./week-plan-sync";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";

export type ExecutionTaskDocument = CommercialExecutionTask & { _id: string };
export function serializeCommercialExecution(row: ExecutionTaskDocument) {
  const { _id, ...data } = row;
  void _id;
  return commercialExecutionTaskSchema.parse(data);
}
export async function applyCommercialExecutionCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string, messageFr: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: { error: { code, messageFr, retryable: false, requestId } },
  });
  const parsed = commercialExecutionTaskSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_execution_task"
  )
    return reject(
      "COMMERCIAL_EXECUTION_INVALID",
      "Vérifiez le statut de la tâche et sa note.",
    );
  const plan = parsed.data,
    id = await commercialExecutionTaskId(
      storeId,
      plan.planRevisionId,
      plan.planChecksum,
      plan.kind,
      plan.targetId,
      async (text) => createHash("sha256").update(text).digest("hex"),
    );
  if (id !== plan.id)
    return reject(
      "COMMERCIAL_EXECUTION_ID_INVALID",
      "La tâche ne correspond pas à cette version du plan.",
    );
  const collection = ctx.database.collection<ExecutionTaskDocument>(
      "commercialExecutionTasks",
    ),
    previous = await collection.findOne(
      { _id: id, storeId },
      { session: ctx.session },
    );
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous
          ? { remoteEntity: serializeCommercialExecution(previous) }
          : {}),
        error: {
          code: "COMMERCIAL_EXECUTION_VERSION_CONFLICT",
          messageFr:
            "La tâche a changé sur un autre appareil. Comparez les statuts et les notes.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    plan.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !commercialExecutionSameIdentity(
        plan,
        serializeCommercialExecution(previous),
      ))
  )
    return reject(
      "COMMERCIAL_EXECUTION_REVISION_INVALID",
      "Rouvrez la tâche avant de modifier sa révision.",
    );
  const revision = await ctx.database
    .collection<PlanRevisionDocument>("commercialPlanRevisions")
    .findOne({ _id: plan.planRevisionId, storeId }, { session: ctx.session });
  if (!revision) throw Error("COMMERCIAL_EXECUTION_PLAN_PENDING");
  const proposals = await commercialExecutionChecklist(
    serializeCommercialPlanRevision(revision).plan,
    async (text) => createHash("sha256").update(text).digest("hex"),
  );
  if (!proposals.some((p) => commercialExecutionSameTarget(plan, p)))
    return reject(
      "COMMERCIAL_EXECUTION_PLAN_CHANGED",
      "La tâche ne correspond pas à la version confirmée du plan. Votre déclaration locale reste conservée ; revoyez la version concernée.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("commercialExecutionHistory").insertOne(
    {
      storeId,
      taskId: id,
      version: plan.version,
      commandId: command.commandId,
      plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_execution_task",
    entityId: id,
    entityVersion: plan.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: plan.version,
    responseJson: { remoteEntity: plan },
  };
}
