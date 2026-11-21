import { createHash } from "node:crypto";
import type { Document } from "mongodb";
import {
  MAX_PROCUREMENT_SOURCE_BYTES,
  storeContextSettingsSchema,
} from "@fl-copilot/domain";
import {
  parseProcurementCatalogue,
  serializeProcurementCatalogue,
  procurementCatalogueBytes,
} from "@fl-copilot/import-core";
import {
  procurementPublicationSchema,
  synchronizedProcurementCatalogueSchema,
  serializeProcurementPublication,
  type SynchronizedProcurementCatalogue,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import { sourceObjectKey } from "../uploads/source-upload-service";
import {
  createVercelPrivateSourceReader,
  type PrivateSourceReader,
} from "./import-verification-service";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";

export type ProcurementSnapshotDocument = SynchronizedProcurementCatalogue & {
  _id: string;
};
export class ProcurementPublicationPendingError extends Error {}
export function serializeProcurementSnapshot(row: ProcurementSnapshotDocument) {
  const { _id, ...entity } = row;
  if (_id !== entity.id) throw Error("PROCUREMENT_SNAPSHOT_IDENTITY_INVALID");
  return synchronizedProcurementCatalogueSchema.parse(entity);
}
export async function applyProcurementPublicationCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string | undefined,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  reader: PrivateSourceReader = createVercelPrivateSourceReader(),
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Vérifie le fichier et le code PDV du magasin. L’original local est conservé.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = procurementPublicationSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    command.entityType !== "procurement_catalogue_snapshot" ||
    command.type !== "PROCUREMENT_CATALOGUE_PUBLISH" ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    parsed.data.ownerId !== ownerId
  )
    return reject("PROCUREMENT_SCOPE_INVALID");
  const p = parsed.data,
    options = { session: ctx.session };
  const membership = await ctx.database
    .collection("storeMemberships")
    .findOne(
      { storeId, userId: ownerId, active: true, role: "MANAGER" },
      options,
    );
  if (!membership) return reject("PROCUREMENT_SCOPE_INVALID");
  const collection = ctx.database.collection<ProcurementSnapshotDocument>(
    "procurementCatalogueSnapshots",
  );
  const old = await collection.findOne({ _id: p.id }, options);
  if (old && old.storeId !== storeId)
    return reject("PROCUREMENT_SCOPE_INVALID");
  const conflict = (
    existing: ProcurementSnapshotDocument | null,
  ): CommandMutationResult => ({
    resultStatus: "CONFLICT",
    resultingVersion: existing?.version ?? null,
    responseJson: {
      ...(existing
        ? {
            remoteEntity: serializeProcurementSnapshot(existing),
          }
        : {}),
      error: {
        code: "PROCUREMENT_SNAPSHOT_IMMUTABLE",
        messageFr:
          "Un aperçu différent existe déjà. Les deux sources sont conservées pour vérification.",
        retryable: false,
        requestId,
      },
    },
  });
  if (old)
    return serializeProcurementPublication(old.publication) ===
      serializeProcurementPublication(p)
      ? {
          resultStatus: "APPLIED",
          resultingVersion: 1,
          responseJson: {
            remoteEntity: serializeProcurementSnapshot(old),
          },
        }
      : conflict(old);
  if (command.expectedRemoteVersion != null) return conflict(null);
  const duplicate = await collection.findOne(
    {
      storeId,
      $or: [
        { "publication.checksum": p.checksum },
        { "publication.catalogue.asOf": p.catalogue.asOf },
      ],
    },
    options,
  );
  if (duplicate) return conflict(duplicate);
  const config = await ctx.database
    .collection<Document & { _id: string }>("storeContextSettings")
    .findOne({ _id: storeId, storeId }, options);
  const settings = storeContextSettingsSchema.safeParse(
    Object.fromEntries(
      Object.entries(config ?? {}).filter(([key]) => key !== "_id"),
    ),
  );
  const pdv = settings.success ? settings.data.pdvCode : null;
  if (!pdv)
    throw new ProcurementPublicationPendingError(
      "PROCUREMENT_STORE_PDV_PENDING",
    );
  if (BigInt(pdv) !== BigInt(p.catalogue.pdv))
    throw new ProcurementPublicationPendingError("PROCUREMENT_PDV_MISMATCH");
  const source = await ctx.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .findOne(
      {
        _id: p.sourceDocumentId,
        storeId,
        sourceType: "PROCUREMENT_CATALOGUE",
        checksum: p.checksum,
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      },
      options,
    );
  const upload = await ctx.database.collection("sourceUploads").findOne(
    {
      sourceDocumentId: p.sourceDocumentId,
      storeId,
      userId: ownerId,
      sourceType: "PROCUREMENT_CATALOGUE",
      status: "CONFIRMED",
      checksum: p.checksum,
    },
    options,
  );
  if (!source || !upload)
    throw new ProcurementPublicationPendingError(
      "PROCUREMENT_ORIGINAL_PENDING",
    );
  if (
    upload.filename !== p.originalFilename ||
    upload.mimeType !== "application/json" ||
    !Number.isSafeInteger(upload.sizeBytes) ||
    upload.sizeBytes <= 0 ||
    upload.sizeBytes > MAX_PROCUREMENT_SOURCE_BYTES ||
    source.objectKey !== upload.objectKey ||
    upload.objectKey !==
      sourceObjectKey(storeId, {
        sourceDocumentId: p.sourceDocumentId,
        sourceType: "PROCUREMENT_CATALOGUE",
        filename: p.originalFilename,
        mimeType: "application/json",
        sizeBytes: upload.sizeBytes,
        checksum: p.checksum,
      })
  )
    return reject("PROCUREMENT_ORIGINAL_INVALID");
  const bytes = await reader.read(String(upload.objectKey));
  if (!bytes)
    throw new ProcurementPublicationPendingError(
      "PROCUREMENT_ORIGINAL_UNAVAILABLE",
    );
  const hash = (b: Uint8Array) =>
    "sha256:" + createHash("sha256").update(b).digest("hex");
  if (bytes.length !== upload.sizeBytes || hash(bytes) !== p.checksum)
    return reject("PROCUREMENT_SOURCE_CHANGED");
  let original;
  try {
    original = parseProcurementCatalogue(bytes, pdv);
  } catch {
    return reject("PROCUREMENT_SOURCE_INVALID");
  }
  if (
    serializeProcurementCatalogue(original) !==
      serializeProcurementCatalogue(p.catalogue) ||
    hash(procurementCatalogueBytes(original)) !== p.normalizedChecksum
  )
    return reject("PROCUREMENT_NORMALIZATION_INVALID");
  const entity = synchronizedProcurementCatalogueSchema.parse({
    id: p.id,
    storeId,
    version: 1,
    publication: p,
  });
  await collection.insertOne({ _id: p.id, ...entity }, options);
  await ctx.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .updateOne(
      { _id: p.sourceDocumentId, storeId },
      {
        $set: {
          remoteProcessingStatus: "PUBLISHED",
          verificationStatus: "MATCH",
        },
      },
      options,
    );
  await changes.append(ctx, {
    storeId,
    entityType: "procurement_catalogue_snapshot",
    entityId: p.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: entity },
  };
}
