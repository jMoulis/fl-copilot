import {
  personalTaskSchema,
  samePersonalTask,
  type PersonalTask,
} from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";
export type PersonalTaskDocument = PersonalTask & { _id: string };
export function serializePersonalTask(row: PersonalTaskDocument) {
  const { _id, ...data } = row;
  const task = personalTaskSchema.parse(data);
  if (_id !== task.id) throw Error("PERSONAL_TASK_IDENTITY_INVALID");
  return task;
}
/** Checked before processed-command replay, not just before a new write. */
export async function canAccessPersonalTask(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  const p = personalTaskSchema.safeParse(c.payload);
  if (
    !ownerId ||
    !p.success ||
    c.type !== "PERSONAL_TASK_UPSERT" ||
    c.entityType !== "personal_task" ||
    p.data.id !== c.entityId ||
    p.data.storeId !== storeId ||
    p.data.ownerId !== ownerId
  )
    return false;
  const old = await db
    .collection<PersonalTaskDocument>("personalTasks")
    .findOne({ _id: c.entityId });
  return !old || (old.storeId === storeId && old.ownerId === ownerId);
}
export async function applyPersonalTask(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string,
  c: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Ce pense-bête doit être vérifié. Ta saisie locale est conservée.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessPersonalTask(ctx.database, storeId, ownerId, c)))
    return reject("PERSONAL_TASK_SCOPE_INVALID");
  const e = personalTaskSchema.parse(c.payload),
    col = ctx.database.collection<PersonalTaskDocument>("personalTasks"),
    old = await col.findOne({ _id: e.id }, { session: ctx.session });
  if (old && !samePersonalTask(serializePersonalTask(old), e))
    return reject("PERSONAL_TASK_IDENTITY_INVALID");
  if ((c.expectedRemoteVersion ?? null) !== (old?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: old?.version ?? null,
      responseJson: {
        ...(old ? { remoteEntity: serializePersonalTask(old) } : {}),
        error: {
          code: "PERSONAL_TASK_CONFLICT",
          messageFr:
            "Ce pense-bête a changé sur un autre appareil. Compare les deux versions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    e.version !== (old?.version ?? 0) + 1 ||
    (old && e.updatedAt < old.updatedAt)
  )
    return reject("PERSONAL_TASK_REVISION_INVALID");
  await col.replaceOne({ _id: e.id, storeId, ownerId }, e, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("personalTaskHistory").insertOne(
    {
      taskId: e.id,
      storeId,
      ownerId,
      version: e.version,
      commandId: c.commandId,
      task: e,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "personal_task",
    entityId: e.id,
    entityVersion: e.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: e.version,
    responseJson: { remoteEntity: e },
  };
}
