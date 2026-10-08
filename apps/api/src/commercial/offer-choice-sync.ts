import { createHash } from "node:crypto";
import {
  commercialOfferChoiceSchema,
  type CommercialOfferChoice,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialChoiceId,
  commercialChoiceDuplicateKey,
  commercialChoiceSameSource,
} from "@fl-copilot/commercial-core";
import type { VisualReadingDocument } from "./visual-reading-store.js";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service.js";
import type { createMongoSyncChangeService } from "../sync/sync-change-service.js";
export type OfferChoiceDocument = CommercialOfferChoice & {
  _id: string;
  duplicateKey: string;
};
export function serializeCommercialChoice(row: OfferChoiceDocument) {
  const { _id: _ignored, duplicateKey: _key, ...choice } = row;
  void _ignored;
  void _key;
  return commercialOfferChoiceSchema.parse(choice);
}
export async function applyCommercialChoiceCommand(
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
  const parsed = commercialOfferChoiceSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_offer_choice"
  )
    return reject(
      "COMMERCIAL_CHOICE_INVALID",
      "Vérifiez le produit, les dates, le mécanisme et les confirmations du choix commercial.",
    );
  const choice = parsed.data;
  const id = await commercialChoiceId(storeId, choice.source, async (text) =>
    createHash("sha256").update(text).digest("hex"),
  );
  if (id !== choice.id)
    return reject(
      "COMMERCIAL_CHOICE_IDENTITY_INVALID",
      "Le choix ne correspond pas à son extrait source.",
    );
  const source = await ctx.database
    .collection<VisualReadingDocument>("commercialVisualReadings")
    .findOne(
      {
        _id: choice.source.readingId,
        storeId,
        sourceDocumentId: choice.source.sourceDocumentId,
        checksum: choice.source.checksum,
        status: "READY",
      },
      { session: ctx.session },
    );
  const operation = source?.reading?.operations[choice.source.operationIndex],
    item = operation?.items[choice.source.itemIndex];
  if (
    !operation ||
    item?.kind !== "OFFER" ||
    operation.kind !== choice.operationKind ||
    operation.label !== choice.operationLabel ||
    item.label !== choice.rawProductLabel
  )
    return reject(
      "COMMERCIAL_CHOICE_SOURCE_INVALID",
      "L’offre source est indisponible ou ne correspond pas au choix. Consultez le PDF original.",
    );
  const collection = ctx.database.collection<OfferChoiceDocument>(
    "commercialOfferChoices",
  );
  const previous = await collection.findOne(
    { _id: choice.id, storeId },
    { session: ctx.session },
  );
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous
          ? { remoteEntity: serializeCommercialChoice(previous) }
          : {}),
        error: {
          code: "COMMERCIAL_CHOICE_VERSION_CONFLICT",
          messageFr:
            "Le choix de cette offre a changé sur un autre appareil. Comparez les deux choix avant de décider.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    choice.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !commercialChoiceSameSource(choice, serializeCommercialChoice(previous)))
  )
    return reject(
      "COMMERCIAL_CHOICE_REVISION_INVALID",
      "La révision du choix ne conserve pas son identité et sa source.",
    );
  if (choice.status === "RETAINED") {
    const product = await ctx.database
      .collection<{ _id: string; salesUnit: string }>("products")
      .findOne(
        { _id: choice.productId, storeId, status: "ACTIVE", deletedAt: null },
        { session: ctx.session },
      );
    if (!product)
      return reject(
        "COMMERCIAL_CHOICE_PRODUCT_INVALID",
        "Le produit associé n’est plus disponible pour ce magasin. Choisissez un produit actif.",
      );
  }
  const duplicateKey = createHash("sha256")
    .update(commercialChoiceDuplicateKey(choice))
    .digest("hex");
  if (
    choice.status === "RETAINED" &&
    (await collection.findOne(
      { _id: { $ne: choice.id }, storeId, status: "RETAINED", duplicateKey },
      { session: ctx.session },
    ))
  )
    return reject(
      "COMMERCIAL_CHOICE_DUPLICATE",
      "Une offre identique est déjà retenue pour ce produit, cette période et ce document. Consultez les offres retenues.",
    );
  await collection.replaceOne(
    { _id: choice.id, storeId },
    { ...choice, duplicateKey },
    { upsert: true, session: ctx.session },
  );
  await ctx.database.collection("commercialChoiceHistory").insertOne(
    {
      storeId,
      choiceId: choice.id,
      version: choice.version,
      commandId: command.commandId,
      choice,
      recordedAt: new Date(),
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_offer_choice",
    entityId: choice.id,
    entityVersion: choice.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: choice.version,
    responseJson: { remoteEntity: choice },
  };
}
