import type { Document } from "mongodb";
import { Decimal128 } from "mongodb";
import {
  wastePublicationSchema,
  synchronizedWastePublicationSchema,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import { validateWasteReceiptArithmetic } from "@fl-copilot/analytics-core";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service.js";
import type { createMongoSyncChangeService } from "../sync/sync-change-service.js";
import type { SynchronizedWastePublication } from "@fl-copilot/sync-contracts";

export type WastePublicationDocument = SynchronizedWastePublication & {
  _id: string;
  version: number;
};
export async function applyWastePublicationCommand(
  context: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const rejected = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Le ticket ne peut pas être publié. Vérifiez ses lignes et sa source.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = wastePublicationSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    command.entityType !== "waste_receipt_publication" ||
    parsed.data.receipt.id !== command.entityId ||
    parsed.data.receipt.storeId !== storeId
  )
    return rejected("WASTE_PUBLICATION_INVALID");
  const p = parsed.data;
  const collection = context.database.collection<WastePublicationDocument>(
    "wasteReceiptPublications",
  );
  const existing = await collection.findOne(
    { _id: command.entityId },
    { session: context.session },
  );
  if (existing) {
    if (existing.storeId !== storeId)
      return rejected("SYNC_ENTITY_STORE_MISMATCH");
    if (JSON.stringify(existing.publication) !== JSON.stringify(p))
      return {
        resultStatus: "CONFLICT",
        resultingVersion: existing.version,
        responseJson: {
          remoteEntity: synchronizedWastePublicationSchema.parse(existing),
          error: {
            code: "WASTE_RECEIPT_ALREADY_PUBLISHED",
            messageFr: "Ce ticket est déjà publié avec une autre validation.",
            retryable: false,
            requestId,
          },
        },
      };
    return {
      resultStatus: "APPLIED",
      resultingVersion: existing.version,
      responseJson: {
        remoteEntity: synchronizedWastePublicationSchema.parse(existing),
      },
    };
  }
  if (command.expectedRemoteVersion != null)
    return rejected("WASTE_PUBLICATION_VERSION_INVALID");
  const source = await context.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .findOne(
      {
        _id: p.source.id,
        storeId,
        sourceType: "WASTE_RECEIPT",
        remoteUploadStatus: "CONFIRMED",
        checksum: p.source.checksum,
      },
      { session: context.session },
    );
  if (!source) return rejected("WASTE_PUBLICATION_SOURCE_INVALID");
  for (const o of p.observations) {
    const line = p.lines.find((l) => l.id === o.sourceRecordId)!;
    const product = await context.database
      .collection<Document & { _id: string }>("products")
      .findOne(
        { _id: o.productId, storeId, deletedAt: null, status: "ACTIVE" },
        { session: context.session },
      );
    const quantity =
      product?.salesUnit === "KG"
        ? line.weight
        : line.quantityUnit === product?.salesUnit
          ? line.quantity
          : null;
    const arithmetic = validateWasteReceiptArithmetic([
      {
        sourceLineIndex: line.sourceLineIndex,
        weight: line.weight ?? null,
        unitPrice: line.unitPrice ?? null,
        totalPrice: line.totalPrice ?? null,
      },
    ]).lines[0]!;
    if (
      !product ||
      product.nature !== o.productNature ||
      quantity == null ||
      Number(quantity) <= 0 ||
      quantity !== o.quantity ||
      arithmetic.status === "MISMATCH"
    )
      return rejected("WASTE_PUBLICATION_LINE_INVALID");
  }
  const document: WastePublicationDocument = {
    _id: p.receipt.id,
    id: p.receipt.id,
    storeId,
    remoteVersion: 1,
    version: 1,
    publication: p,
  };
  await collection.insertOne(document, { session: context.session });
  await context.database
    .collection<Document & { _id: string }>("wasteReceipts")
    .insertOne(
      {
        ...p.receipt,
        _id: p.receipt.id,
        createdAt: new Date(p.receipt.createdAt),
        updatedAt: new Date(p.receipt.updatedAt),
        syncState: "SYNCED",
        dirty: false,
        remoteVersion: 1,
      },
      { session: context.session },
    );
  for (const line of p.lines) {
    await context.database
      .collection<Document & { _id: string }>("wasteLines")
      .insertOne(
        {
          ...line,
          _id: line.id,
          createdAt: new Date(line.createdAt),
          updatedAt: new Date(line.updatedAt),
          syncState: "SYNCED",
          dirty: false,
          remoteVersion: 1,
        },
        { session: context.session },
      );
    await context.database
      .collection<Document & { _id: string }>("sourceRecords")
      .insertOne(
        {
          _id: line.id,
          storeId,
          sourceDocumentId: p.source.id,
          sourceIndex: line.sourceLineIndex,
          rawPayload: line,
          status: "VALIDATED",
        },
        { session: context.session },
      );
  }
  for (const o of p.observations) {
    await context.database
      .collection<Document & { _id: string }>("wasteObservations")
      .insertOne(
        {
          ...o,
          _id: o.id,
          date: o.businessDate,
          quantity:
            o.quantity === null ? null : Decimal128.fromString(o.quantity),
          salesValue:
            o.salesValue === null ? null : Decimal128.fromString(o.salesValue),
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
          syncState: "SYNCED",
          remoteVersion: 1,
          dirty: false,
        },
        { session: context.session },
      );
  }
  await context.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .updateOne(
      { _id: p.source.id, storeId },
      {
        $set: {
          remoteProcessingStatus: "PUBLISHED",
          updatedAt: new Date(p.receipt.updatedAt),
        },
      },
      { session: context.session },
    );
  await changes.append(context, {
    storeId,
    entityType: "waste_receipt_publication",
    entityId: p.receipt.id,
    operation: "UPSERT",
    entityVersion: 1,
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: {
      remoteEntity: synchronizedWastePublicationSchema.parse(document),
    },
  };
}
