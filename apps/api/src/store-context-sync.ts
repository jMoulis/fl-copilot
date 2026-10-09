import {
  storeContextSettingsSchema,
  type StoreContextSettings,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";

export type StoreContextDocument = StoreContextSettings & { _id: string };
export function serializeStoreContext(row: StoreContextDocument) {
  const { _id, ...data } = row;
  void _id;
  return storeContextSettingsSchema.parse(data);
}
export async function applyStoreContextCommand(
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
  const parsed = storeContextSettingsSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "store_context_settings"
  )
    return reject(
      "STORE_CONTEXT_INVALID",
      "Vérifiez la commune, le code postal et la localisation du magasin.",
    );
  const plan = parsed.data,
    id = plan.storeId;
  const collection = ctx.database.collection<StoreContextDocument>(
      "storeContextSettings",
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
        ...(previous ? { remoteEntity: serializeStoreContext(previous) } : {}),
        error: {
          code: "STORE_CONTEXT_VERSION_CONFLICT",
          messageFr:
            "Les réglages du magasin ont changé sur un autre appareil. Comparez les deux configurations.",
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
      "STORE_CONTEXT_REVISION_INVALID",
      "Rouvrez les réglages du magasin avant de les modifier.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("storeContextHistory").insertOne(
    {
      storeId,
      settingsId: id,
      version: plan.version,
      commandId: command.commandId,
      plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "store_context_settings",
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
