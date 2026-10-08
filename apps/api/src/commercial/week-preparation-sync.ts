import { createHash } from "node:crypto";
import {
  commercialWeekPreparationSchema,
  type CommercialWeekPreparation,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialWeekPreparationId,
  commercialPreparationSameIdentity,
  commercialPreparationOfferIssues,
} from "@fl-copilot/commercial-core";
import type { OfferChoiceDocument } from "./offer-choice-sync";
import { serializeCommercialChoice } from "./offer-choice-sync";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import type { VisualReadingDocument } from "./visual-reading-store";
export type PreparationDocument = CommercialWeekPreparation & { _id: string };
export function serializeCommercialPreparation(row: PreparationDocument) {
  const { _id, ...data } = row;
  void _id;
  return commercialWeekPreparationSchema.parse(data);
}
export async function applyCommercialPreparationCommand(
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
  const parsed = commercialWeekPreparationSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_week_preparation"
  )
    return reject(
      "COMMERCIAL_PREPARATION_INVALID",
      "Vérifiez la semaine, la capacité des TG et les offres affectées.",
    );
  const plan = parsed.data,
    id = await commercialWeekPreparationId(
      storeId,
      plan.weekStart,
      async (text) => createHash("sha256").update(text).digest("hex"),
    );
  if (id !== plan.id)
    return reject(
      "COMMERCIAL_PREPARATION_ID_INVALID",
      "La préparation ne correspond pas à cette semaine du magasin.",
    );
  const collection = ctx.database.collection<PreparationDocument>(
      "commercialWeekPreparations",
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
        ...(previous
          ? { remoteEntity: serializeCommercialPreparation(previous) }
          : {}),
        error: {
          code: "COMMERCIAL_PREPARATION_VERSION_CONFLICT",
          messageFr:
            "La préparation a changé sur un autre appareil. Comparez les deux versions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    plan.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !commercialPreparationSameIdentity(
        plan,
        serializeCommercialPreparation(previous),
      ))
  )
    return reject(
      "COMMERCIAL_PREPARATION_REVISION_INVALID",
      "Rouvrez la préparation avant de modifier sa révision.",
    );
  const choices = await ctx.database
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .find(
      { storeId, _id: { $in: plan.offerRefs.map((r) => r.choiceId) } },
      { session: ctx.session },
    )
    .toArray();
  if (
    plan.offerRefs.some((ref) => {
      const c = choices.find((c) => c.id === ref.choiceId);
      return !c || c.version < ref.choiceVersion;
    })
  )
    throw Error("COMMERCIAL_PREPARATION_OFFERS_PENDING");
  if (
    commercialPreparationOfferIssues(
      plan,
      choices.map(serializeCommercialChoice),
    ).length
  )
    return reject(
      "COMMERCIAL_PREPARATION_OFFERS_CHANGED",
      "Une offre a été modifiée, retirée ou déplacée hors de la semaine. Relisez les affectations et mettez-les à jour.",
    );
  for (const placement of plan.placements) {
    if (!placement.sourceIdea) continue;
    const src = placement.sourceIdea;
    const reading = await ctx.database
      .collection<VisualReadingDocument>("commercialVisualReadings")
      .findOne(
        {
          _id: src.readingId,
          storeId,
          checksum: src.checksum,
          status: "READY",
        },
        { session: ctx.session },
      );
    if (!reading?.reading?.tgIdeas[src.tgIndex])
      return reject(
        "COMMERCIAL_PREPARATION_SOURCE_INVALID",
        "L’idée de TG ne correspond pas à son document source.",
      );
  }
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("commercialPreparationHistory").insertOne(
    {
      storeId,
      preparationId: id,
      version: plan.version,
      commandId: command.commandId,
      plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_week_preparation",
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
