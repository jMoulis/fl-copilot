import {
  storeLayoutSchema,
  storeLayoutRevisionSchema,
  validateStoreLayoutTransition,
  type StoreLayout,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";
export type StoreLayoutDocument = StoreLayout & { _id: string };
export type StoreLayoutRevisionDocument = ReturnType<
  typeof storeLayoutRevisionSchema.parse
> & { _id: string };
export function serializeStoreLayout(r: StoreLayoutDocument) {
  const { _id, ...p } = r;
  void _id;
  return storeLayoutSchema.parse(p);
}
export function serializeStoreLayoutRevision(r: StoreLayoutRevisionDocument) {
  const { _id, ...p } = r;
  void _id;
  return storeLayoutRevisionSchema.parse(p);
}
export async function applyStoreLayoutCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  actorId?: string,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Le plan reste conservé sur cet appareil. Rouvrez sa version avant de le modifier.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = storeLayoutSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.id !== command.entityId ||
    parsed.data.storeId !== storeId ||
    command.entityType !== "store_layout" ||
    !actorId ||
    parsed.data.updatedBy !== actorId
  )
    return reject("STORE_LAYOUT_INVALID");
  const p = parsed.data,
    collection = ctx.database.collection<StoreLayoutDocument>("storeLayouts"),
    revisions = ctx.database.collection<StoreLayoutRevisionDocument>(
      "storeLayoutRevisions",
    );
  const old = await collection.findOne(
    { _id: storeId, storeId },
    { session: ctx.session },
  );
  if ((command.expectedRemoteVersion ?? null) !== (old?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: old?.version ?? null,
      responseJson: {
        ...(old ? { remoteEntity: serializeStoreLayout(old) } : {}),
        error: {
          code: "STORE_LAYOUT_VERSION_CONFLICT",
          messageFr:
            "Le plan du magasin a changé sur un autre appareil. Comparez les versions avant de choisir.",
          retryable: false,
          requestId,
        },
      },
    };
  const source = p.restoredFromRevisionId
    ? await revisions.findOne(
        { _id: p.restoredFromRevisionId, storeId },
        { session: ctx.session },
      )
    : null;
  try {
    validateStoreLayoutTransition(
      old ? serializeStoreLayout(old) : null,
      p,
      source?.plan ?? null,
    );
  } catch {
    return reject("STORE_LAYOUT_REVISION_INVALID");
  }
  if (await revisions.findOne({ _id: p.revisionId }, { session: ctx.session }))
    return reject("STORE_LAYOUT_REVISION_REUSED");
  const revision = storeLayoutRevisionSchema.parse({
    id: p.revisionId,
    storeId,
    plan: p,
    version: 1,
  });
  await collection.replaceOne({ _id: storeId, storeId }, p, {
    upsert: true,
    session: ctx.session,
  });
  await revisions.insertOne(
    { ...revision, _id: revision.id },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "store_layout",
    entityId: storeId,
    entityVersion: p.version,
    operation: "UPSERT",
  });
  await changes.append(ctx, {
    storeId,
    entityType: "store_layout_revision",
    entityId: revision.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: p.version,
    responseJson: { remoteEntity: p },
  };
}
