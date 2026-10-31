import {
  documentArchiveSchema,
  type DocumentArchive,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  CommandMutationResult,
  MongoCommandMutationContext,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";

export type DocumentArchiveDocument = DocumentArchive & { _id: string };
export function documentArchiveKey(
  storeId: string,
  ownerId: string,
  id: string,
) {
  return [storeId, ownerId, id].join(":");
}
export function serializeDocumentArchive(row: DocumentArchiveDocument) {
  const { _id, ...entity } = row;
  void _id;
  return documentArchiveSchema.parse(entity);
}

/** Ordered explicit visibility intents, not optimistic edits to a business entity.
 * The server commit order determines this reversible personal preference.
 * Processed commands provide retry idempotence; client clocks never arbitrate. */
export async function applyDocumentArchiveCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string | undefined,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  now: () => Date,
): Promise<CommandMutationResult> {
  const parsed = documentArchiveSchema.safeParse(command.payload);
  const reject = (): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code: "DOCUMENT_ARCHIVE_SCOPE_INVALID",
        messageFr:
          "Ce rangement ne correspond pas au compte ou au magasin actif.",
        retryable: false,
        requestId,
      },
    },
  });
  if (
    !parsed.success ||
    !ownerId ||
    parsed.data.ownerId !== ownerId ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "document_archive" ||
    command.type !== "DOCUMENT_ARCHIVE_SET"
  )
    return reject();
  const input = parsed.data;
  const collection =
    ctx.database.collection<DocumentArchiveDocument>("documentArchives");
  const key = documentArchiveKey(storeId, ownerId, input.id);
  const previous = await collection.findOne(
    { _id: key, storeId, ownerId },
    { session: ctx.session },
  );
  if (previous && previous.targetKind !== input.targetKind) return reject();
  // A not-yet-uploaded source or device-local batch may be archived. This marker
  // neither registers a source nor grants access to its bytes or business data.
  const entity = documentArchiveSchema.parse({
    ...input,
    version: (previous?.version ?? 0) + 1,
    updatedAt: now().toISOString(),
  });
  await collection.replaceOne({ _id: key, storeId, ownerId }, entity, {
    upsert: true,
    session: ctx.session,
  });
  await changes.append(ctx, {
    storeId,
    entityType: "document_archive",
    entityId: input.id,
    entityVersion: entity.version,
    operation: "UPSERT",
    payloadRevision: ownerId,
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: entity.version,
    responseJson: { remoteEntity: entity },
  };
}
