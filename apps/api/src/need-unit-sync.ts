import {
  needUnitSchema,
  type NeedUnit,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";

export type NeedUnitDocument = NeedUnit & { _id: string };
export function serializeNeedUnit(row: NeedUnitDocument) {
  const { _id, ...data } = row;
  void _id;
  return needUnitSchema.parse(data);
}
export async function applyNeedUnitCommand(
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
  const parsed = needUnitSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "need_unit"
  )
    return reject(
      "NEED_UNIT_INVALID",
      "Vérifiez le code, le nom et la description du besoin client.",
    );
  const plan = parsed.data,
    id = plan.id;
  const collection = ctx.database.collection<NeedUnitDocument>("needUnits"),
    previous = await collection.findOne(
      { _id: id, storeId },
      { session: ctx.session },
    );
  const foreign = await collection.findOne(
    { _id: id },
    { session: ctx.session },
  );
  if (foreign && foreign.storeId !== storeId)
    return reject(
      "NEED_UNIT_STORE_INVALID",
      "Cette unité ne peut pas être réaffectée à un autre magasin.",
    );
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous ? { remoteEntity: serializeNeedUnit(previous) } : {}),
        error: {
          code: "NEED_UNIT_VERSION_CONFLICT",
          messageFr:
            "Cette unité de besoin a changé sur un autre appareil. Comparez les deux versions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    plan.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !(
        plan.id === previous.id &&
        plan.storeId === previous.storeId &&
        plan.createdAt === previous.createdAt
      ))
  )
    return reject(
      "NEED_UNIT_REVISION_INVALID",
      "Rouvrez cette unité de besoin avant de la modifier.",
    );
  if (!previous && plan.createdBy !== "USER")
    return reject(
      "NEED_UNIT_ORIGIN_INVALID",
      "Cette création doit être une décision utilisateur.",
    );
  if (
    previous &&
    (previous.code !== plan.code || previous.createdBy !== plan.createdBy)
  )
    return reject(
      "NEED_UNIT_IDENTITY_CHANGED",
      "Le code et l’origine d’une unité synchronisée sont conservés.",
    );
  const duplicate = await collection.findOne(
    { storeId, code: plan.code, _id: { $ne: id } },
    { session: ctx.session },
  );
  if (duplicate)
    return reject(
      "NEED_UNIT_CODE_IN_USE",
      "Ce code est déjà utilisé pour un autre besoin client, y compris désactivé.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("needUnitHistory").insertOne(
    {
      storeId,
      needUnitId: id,
      version: plan.version,
      commandId: command.commandId,
      unit: plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "need_unit",
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
