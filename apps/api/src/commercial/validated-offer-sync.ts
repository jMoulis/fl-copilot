import { createHash } from "node:crypto";
import {
  commercialValidatedOfferSchema,
  type CommercialValidatedOffer,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
  commercialValidatedOfferSameBusiness,
  commercialOfferValidationCurrent,
} from "@fl-copilot/commercial-core";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "./offer-choice-sync";
import type { VisualReadingDocument } from "./visual-reading-store";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
export type ValidatedOfferDocument = CommercialValidatedOffer & { _id: string };
export function serializeValidatedOffer(row: ValidatedOfferDocument) {
  const { _id, ...data } = row;
  void _id;
  return commercialValidatedOfferSchema.parse(data);
}
export async function applyValidatedOfferCommand(
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
  const parsed = commercialValidatedOfferSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_validated_offer" ||
    command.expectedRemoteVersion != null
  )
    return reject(
      "COMMERCIAL_VALIDATION_INVALID",
      "Rouvrez les offres sélectionnées et vérifiez leur version avant de valider.",
    );
  const v = parsed.data,
    id = await commercialValidatedOfferId(
      storeId,
      v.choice.id,
      v.choice.version,
      async (s) => createHash("sha256").update(s).digest("hex"),
    );
  if (id !== v.id)
    return reject(
      "COMMERCIAL_VALIDATION_ID_INVALID",
      "La validation ne correspond pas à cette version de l’offre.",
    );
  const collection = ctx.database.collection<ValidatedOfferDocument>(
      "commercialValidatedOffers",
    ),
    old = await collection.findOne(
      { _id: id, storeId },
      { session: ctx.session },
    );
  // A retry of an already validated immutable revision cannot republish it or revert a later choice.
  if (old) {
    if (!commercialValidatedOfferSameBusiness(v, serializeValidatedOffer(old)))
      return reject(
        "COMMERCIAL_VALIDATION_IMMUTABLE",
        "Cette validation est conservée dans l’historique. Modifiez le choix de l’offre pour valider une nouvelle version.",
      );
    return {
      resultStatus: "APPLIED",
      resultingVersion: 1,
      responseJson: { remoteEntity: serializeValidatedOffer(old) },
    };
  }
  const row = await ctx.database
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .findOne({ _id: v.choice.id, storeId }, { session: ctx.session });
  if (!row || row.version < v.choice.version)
    throw Error("COMMERCIAL_VALIDATION_CHOICE_PENDING");
  const choice = serializeCommercialChoice(row);
  if (!commercialOfferValidationCurrent(v, choice))
    return reject(
      "COMMERCIAL_VALIDATION_CHOICE_CHANGED",
      "Le choix a été modifié, retiré ou est en conflit. Revoyez sa version avant de le valider.",
    );
  if (
    !(await ctx.database
      .collection<{ _id: string }>("products")
      .findOne(
        { _id: choice.productId, storeId, status: "ACTIVE", deletedAt: null },
        { session: ctx.session },
      ))
  )
    return reject(
      "COMMERCIAL_VALIDATION_PRODUCT_INVALID",
      "Le produit associé n’est plus actif dans ce magasin. Revoyez l’offre.",
    );
  const pages = await ctx.database
    .collection<VisualReadingDocument>("commercialVisualReadings")
    .find({ _id: choice.source.readingId, storeId }, { session: ctx.session })
    .toArray();
  let source;
  try {
    source = commercialOfferValidationSource(choice, pages);
  } catch {
    return reject(
      "COMMERCIAL_VALIDATION_SOURCE_INVALID",
      "L’offre ne correspond pas à la source. Consultez le PDF original.",
    );
  }
  if (!commercialValidatedOfferSameBusiness(v, { ...v, ...source }))
    return reject(
      "COMMERCIAL_VALIDATION_SOURCE_INVALID",
      "Les conditions ou citations ont changé. Rouvrez la source avant de confirmer.",
    );
  await collection.insertOne({ ...v, _id: id }, { session: ctx.session });
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_validated_offer",
    entityId: id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: v },
  };
}
