import { sourceObjectKey } from "../uploads/source-upload-service";
import { createHash } from "node:crypto";
import {
  procurementLinkIdentityKey,
  procurementLinkIdFromHash,
  procurementLinkReviewSchema,
  procurementProductLinkSchema,
  validateProcurementLinkRevision,
  validateProcurementLinkChoice,
  buildProcurementCrosswalk,
  storeContextSettingsSchema,
  type ProcurementLinkReview,
  type ProcurementProductLink,
} from "@fl-copilot/domain";
import {
  parseMercalysReferenceIdentities,
  SheetJsSpreadsheetParser,
} from "@fl-copilot/import-core";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type { Document, AnyBulkWriteOperation } from "mongodb";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  createVercelPrivateSourceReader,
  type PrivateSourceReader,
} from "./import-verification-service";
import {
  serializeProductDocument,
  serializeProductIdentifierDocument,
  type ProductDocument,
  type ProductIdentifierDocument,
} from "../products/product-master";
import {
  serializeProcurementSnapshot,
  type ProcurementSnapshotDocument,
} from "./procurement-publication-sync";
export type ProcurementReviewDocument = ProcurementLinkReview & { _id: string };
export type ProcurementLinkDocument = ProcurementProductLink & { _id: string };
export class ProcurementLinkPendingError extends Error {}
export function serializeProcurementReview(row: ProcurementReviewDocument) {
  const { _id, ...r } = row;
  if (_id !== r.id) throw Error("PROCUREMENT_REVIEW_IDENTITY_INVALID");
  return procurementLinkReviewSchema.parse(r);
}
function linkDto(row: ProcurementLinkDocument) {
  const { _id, ...r } = row;
  if (_id !== r.id) throw Error("PROCUREMENT_LINK_IDENTITY_INVALID");
  return procurementProductLinkSchema.parse(r);
}
export async function applyProcurementLinkReview(
  ctx: MongoCommandMutationContext,
  storeId: string,
  actorId: string | undefined,
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
          "Les correspondances doivent être vérifiées. Les choix locaux sont conservés.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = procurementLinkReviewSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    command.entityType !== "procurement_link_review" ||
    command.type !== "PROCUREMENT_LINK_REVIEW_PUBLISH" ||
    parsed.data.id !== command.entityId ||
    parsed.data.storeId !== storeId ||
    parsed.data.actorId !== actorId ||
    command.expectedRemoteVersion != null
  )
    return reject("PROCUREMENT_LINK_SCOPE_INVALID");
  const review = parsed.data;
  if (
    review.decisions.some(
      (d) =>
        d.link.id !==
        procurementLinkIdFromHash(
          "sha256:" +
            createHash("sha256")
              .update(procurementLinkIdentityKey(storeId, d.link.genericId))
              .digest("hex"),
        ),
    )
  )
    return reject("PROCUREMENT_LINK_IDENTITY_INVALID");
  const options = { session: ctx.session };
  if (
    !(await ctx.database
      .collection("storeMemberships")
      .findOne(
        { storeId, userId: actorId, active: true, role: "MANAGER" },
        options,
      ))
  )
    return reject("PROCUREMENT_LINK_SCOPE_INVALID");
  const reviews = ctx.database.collection<ProcurementReviewDocument>(
    "procurementLinkReviews",
  );
  const oldReview = await reviews.findOne({ _id: review.id }, options);
  if (oldReview) {
    if (oldReview.storeId !== storeId)
      return reject("PROCUREMENT_LINK_SCOPE_INVALID");
    return JSON.stringify(serializeProcurementReview(oldReview)) ===
      JSON.stringify(review)
      ? {
          resultStatus: "APPLIED",
          resultingVersion: 1,
          responseJson: { remoteEntity: review },
        }
      : reject("PROCUREMENT_REVIEW_IMMUTABLE");
  }
  const links = ctx.database.collection<ProcurementLinkDocument>(
    "procurementProductLinks",
  );
  const ids = review.decisions.map((d) => d.link.id),
    generics = review.decisions.map((d) => d.link.genericId);
  const existing = await links
    .find(
      {
        $or: [{ _id: { $in: ids } }, { storeId, genericId: { $in: generics } }],
      },
      options,
    )
    .toArray();
  if (existing.some((l) => l.storeId !== storeId))
    return reject("PROCUREMENT_LINK_SCOPE_INVALID");
  const conflict = (code: string): CommandMutationResult => ({
    resultStatus: "CONFLICT",
    resultingVersion: null,
    responseJson: {
      remoteEntity: {
        id: review.id,
        storeId,
        currentLinks: existing.map(linkDto),
      },
      error: {
        code,
        messageFr:
          "Le catalogue ou une correspondance a changé. Compare les choix avant de confirmer à nouveau.",
        retryable: false,
        requestId,
      },
    },
  });
  for (const d of review.decisions) {
    const old = existing.find((l) => l.id === d.link.id);
    if (
      existing.some(
        (l) => l.genericId === d.link.genericId && l.id !== d.link.id,
      ) ||
      (old?.version ?? null) !== d.expectedVersion
    )
      return conflict("PROCUREMENT_LINK_VERSION_CONFLICT");
    try {
      validateProcurementLinkRevision(d.link, old ? linkDto(old) : null);
    } catch {
      return reject("PROCUREMENT_LINK_IDENTITY_INVALID");
    }
  }
  const active = review.decisions.filter((d) => d.link.status === "ACTIVE");
  if (active.length) {
    const settings = await ctx.database
      .collection<Document & { _id: string }>("storeContextSettings")
      .findOne({ _id: storeId, storeId }, options);
    const parsedSettings = storeContextSettingsSchema.safeParse(
      Object.fromEntries(
        Object.entries(settings ?? {}).filter(([k]) => k !== "_id"),
      ),
    );
    const pdv = parsedSettings.success ? parsedSettings.data.pdvCode : null;
    if (!pdv)
      throw new ProcurementLinkPendingError("PROCUREMENT_LINK_PDV_PENDING");
    const [products, identifiers] = await Promise.all([
      ctx.database
        .collection<ProductDocument>("products")
        .find({ storeId, deletedAt: null }, options)
        .toArray(),
      ctx.database
        .collection<ProductIdentifierDocument>("productIdentifiers")
        .find({ storeId, deletedAt: null }, options)
        .toArray(),
    ]);
    const catalog = {
      products: products.map(serializeProductDocument),
      identifiers: identifiers.map(serializeProductIdentifierDocument),
      aliases: [],
    };
    const snapshots = new Map<
      string,
      ReturnType<typeof serializeProcurementSnapshot>
    >();
    const referenceHashes = new Map<string, string>();
    const references = new Map<
      string,
      ReturnType<typeof parseMercalysReferenceIdentities>
    >();
    const previews = new Map<
      string,
      ReturnType<typeof buildProcurementCrosswalk>
    >();
    for (const { link } of active) {
      const b = link.basis;
      if (!catalog.products.some((p) => p.id === link.productId))
        throw new ProcurementLinkPendingError(
          "PROCUREMENT_LINK_PRODUCT_PENDING",
        );
      if (!snapshots.has(b.catalogueSnapshotId)) {
        const row = await ctx.database
          .collection<ProcurementSnapshotDocument>(
            "procurementCatalogueSnapshots",
          )
          .findOne({ _id: b.catalogueSnapshotId, storeId }, options);
        if (!row)
          throw new ProcurementLinkPendingError(
            "PROCUREMENT_LINK_CATALOGUE_PENDING",
          );
        snapshots.set(b.catalogueSnapshotId, serializeProcurementSnapshot(row));
      }
      const snapshot = snapshots.get(b.catalogueSnapshotId)!;
      if (snapshot.publication.checksum !== b.catalogueChecksum)
        return reject("PROCUREMENT_LINK_SOURCE_INVALID");
      if (
        references.has(b.referenceDocumentId) &&
        referenceHashes.get(b.referenceDocumentId) !== b.referenceChecksum
      )
        return reject("PROCUREMENT_LINK_SOURCE_INVALID");
      if (!references.has(b.referenceDocumentId)) {
        const source = await ctx.database
          .collection<Document & { _id: string }>("sourceDocuments")
          .findOne(
            {
              _id: b.referenceDocumentId,
              storeId,
              sourceType: "MERCALYS_PURCHASE_PRICES",
              checksum: b.referenceChecksum,
              remoteUploadStatus: "CONFIRMED",
              deletedAt: null,
            },
            options,
          );
        if (!source)
          throw new ProcurementLinkPendingError(
            "PROCUREMENT_LINK_REFERENCE_PENDING",
          );
        const upload = await ctx.database.collection("sourceUploads").findOne(
          {
            storeId,
            sourceDocumentId: b.referenceDocumentId,
            sourceType: "MERCALYS_PURCHASE_PRICES",
            checksum: b.referenceChecksum,
            status: "CONFIRMED",
          },
          options,
        );
        if (!upload)
          throw new ProcurementLinkPendingError(
            "PROCUREMENT_LINK_REFERENCE_PENDING",
          );
        if (
          !Number.isSafeInteger(upload.sizeBytes) ||
          upload.sizeBytes <= 0 ||
          upload.sizeBytes > 25_000_000 ||
          upload.objectKey !== source.objectKey ||
          upload.objectKey !==
            sourceObjectKey(storeId, {
              sourceDocumentId: b.referenceDocumentId,
              sourceType: "MERCALYS_PURCHASE_PRICES",
              filename: upload.filename,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
              checksum: b.referenceChecksum,
            })
        )
          return reject("PROCUREMENT_LINK_SOURCE_INVALID");
        const bytes = await reader.read(String(source.objectKey));
        if (!bytes)
          throw new ProcurementLinkPendingError(
            "PROCUREMENT_LINK_REFERENCE_UNAVAILABLE",
          );
        if (
          bytes.length !== upload.sizeBytes ||
          "sha256:" + createHash("sha256").update(bytes).digest("hex") !==
            b.referenceChecksum
        )
          return reject("PROCUREMENT_LINK_SOURCE_INVALID");
        try {
          references.set(
            b.referenceDocumentId,
            parseMercalysReferenceIdentities(
              new SheetJsSpreadsheetParser().parse(bytes),
            ),
          );
          referenceHashes.set(b.referenceDocumentId, b.referenceChecksum);
        } catch {
          return reject("PROCUREMENT_LINK_REFERENCE_INVALID");
        }
      }
      const reference = references.get(b.referenceDocumentId)!;
      if (
        BigInt(pdv) !== BigInt(reference.storeCode) ||
        BigInt(pdv) !== BigInt(snapshot.publication.catalogue.pdv)
      )
        throw new ProcurementLinkPendingError("PROCUREMENT_LINK_PDV_PENDING");
      const key = b.catalogueSnapshotId + ":" + b.referenceDocumentId;
      if (!previews.has(key))
        previews.set(
          key,
          buildProcurementCrosswalk(
            snapshot.publication.catalogue.offers,
            reference.references,
          ),
        );
      try {
        validateProcurementLinkChoice(
          link,
          snapshot.publication.catalogue.offers,
          reference.references,
          catalog,
          previews.get(key)!,
        );
      } catch {
        return conflict("PROCUREMENT_LINK_CHOICE_CHANGED");
      }
    }
  }
  const writes: AnyBulkWriteOperation<ProcurementLinkDocument>[] =
    review.decisions.map(({ link, expectedVersion }) =>
      expectedVersion === null
        ? { insertOne: { document: { _id: link.id, ...link } } }
        : {
            replaceOne: {
              filter: { _id: link.id, storeId, version: expectedVersion },
              replacement: { _id: link.id, ...link },
            },
          },
    );
  await links.bulkWrite(writes, options);
  await reviews.insertOne({ _id: review.id, ...review }, options);
  await changes.append(ctx, {
    storeId,
    entityType: "procurement_link_review",
    entityId: review.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: review },
  };
}
