import { createHash } from "node:crypto";
import {
  commercialVersionDecisionSchema,
  type CommercialVersionDecision,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSameIdentity,
  commercialVersionDecisionSourcesValid,
} from "@fl-copilot/commercial-core";

import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import type { VisualReadingDocument } from "./visual-reading-store";
export type VersionDecisionDocument = CommercialVersionDecision & {
  _id: string;
};
export function serializeCommercialVersionDecision(
  row: VersionDecisionDocument,
) {
  const { _id, ...data } = row;
  void _id;
  return commercialVersionDecisionSchema.parse(data);
}
export async function applyCommercialVersionDecisionCommand(
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
  const parsed = commercialVersionDecisionSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_version_decision"
  )
    return reject(
      "COMMERCIAL_VERSION_DECISION_INVALID",
      "Vérifiez les deux documents et confirmez l’examen de la comparaison.",
    );
  const decision = parsed.data,
    id = await commercialVersionDecisionId(
      storeId,
      decision.before.documentId,
      decision.after.documentId,
      async (text) => createHash("sha256").update(text).digest("hex"),
    );
  if (id !== decision.id)
    return reject(
      "COMMERCIAL_VERSION_DECISION_ID_INVALID",
      "La décision ne correspond pas à ces documents du magasin.",
    );
  const collection = ctx.database.collection<VersionDecisionDocument>(
      "commercialVersionDecisions",
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
          ? { remoteEntity: serializeCommercialVersionDecision(previous) }
          : {}),
        error: {
          code: "COMMERCIAL_VERSION_DECISION_VERSION_CONFLICT",
          messageFr:
            "Le choix de référence a changé sur un autre appareil. Comparez les deux décisions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    decision.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !commercialVersionDecisionSameIdentity(
        decision,
        serializeCommercialVersionDecision(previous),
      ))
  )
    return reject(
      "COMMERCIAL_VERSION_DECISION_REVISION_INVALID",
      "Rouvrez la comparaison avant de modifier la décision.",
    );
  const pages = await ctx.database
    .collection<VisualReadingDocument>("commercialVisualReadings")
    .find(
      {
        storeId,
        _id: {
          $in: [...decision.before.readingIds, ...decision.after.readingIds],
        },
      },
      { session: ctx.session },
    )
    .toArray();
  if (!commercialVersionDecisionSourcesValid(decision, pages))
    return reject(
      "COMMERCIAL_VERSION_DECISION_SOURCE_INVALID",
      "Les deux lectures doivent être complètes et correspondre aux originaux comparés.",
    );
  await collection.replaceOne({ _id: id, storeId }, decision, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("commercialVersionDecisionHistory").insertOne(
    {
      storeId,
      decisionId: id,
      version: decision.version,
      commandId: command.commandId,
      decision,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_version_decision",
    entityId: id,
    entityVersion: decision.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: decision.version,
    responseJson: { remoteEntity: decision },
  };
}
