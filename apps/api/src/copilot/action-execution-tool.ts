import { z } from "zod";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  actionExecutionInputSchema,
  actionExecutionPreviewSchema,
  actionExecutionsReadInputSchema,
  actionExecutionsReadResultSchema,
  commercialExecutionActualsNotFuture,
  commercialExecutionActualsSummary,
} from "@fl-copilot/domain";
import { readRecommendationTracking } from "./recommendation-tracking-tool";
import {
  serializeActionExecution,
  type ActionExecutionDocument,
} from "./action-execution-store";
export async function readActionExecutionPreview(
  db: Db,
  scope: { storeId: string; ownerId: string; conversationId: string },
  raw: unknown,
) {
  const input = actionExecutionInputSchema.parse(raw);
  if (
    !commercialExecutionActualsNotFuture(
      input.actuals,
      new Date().toISOString(),
    )
  )
    throw Error("COPILOT_ACTION_EXECUTION_DATE_INVALID");
  const source = await readRecommendationTracking(db, scope, {
    sourceMessageId: input.sourceMessageId,
    quote: input.quote,
  });
  return actionExecutionPreviewSchema.parse({
    input,
    status: source.status,
    snapshot: source.basis
      ? {
          basis: source.basis,
          action: input.action,
          actuals: input.actuals,
          notes: input.notes,
        }
      : null,
    evidence: source.evidence.map((e) => ({
      ...e,
      id: `action-execution-preview/${createHash("sha256")
        .update(JSON.stringify([scope, input, source]))
        .digest("hex")}`,
      label: "Réalisation à confirmer",
      value:
        source.status === "READY"
          ? "Déclaration d’une réalisation préparée, à confirmer explicitement. Aucun choix accepté ni aucune réalisation n’est déduit ; les faits du conseil ne sont pas revalidés et aucun chiffre n’est modifié."
          : "Le conseil d’origine n’est pas vérifiable dans cette conversation active. Aucune déclaration préparée.",
    })),
  });
}
export async function readActionExecutions(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
) {
  z.uuid().parse(scope.storeId);
  z.uuid().parse(scope.ownerId);
  const input = actionExecutionsReadInputSchema.parse(raw);
  const rows = await db
    .collection<ActionExecutionDocument>("actionExecutions")
    .find({
      ...scope,
      ...(input.recommendationId
        ? { recommendationId: input.recommendationId }
        : {}),
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const all = rows.map(serializeActionExecution);
  if (
    all.some((e) => e.storeId !== scope.storeId || e.ownerId !== scope.ownerId)
  )
    throw Error("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
  const entries = all.slice(0, input.limit),
    hasMore = all.length > input.limit;
  const revision = createHash("sha256")
    .update(JSON.stringify([scope, input, entries, hasMore]))
    .digest("hex");
  return actionExecutionsReadResultSchema.parse({
    input,
    entries,
    hasMore,
    nextAfterId: hasMore ? entries.at(-1)!.id : null,
    evidence: [
      {
        id: `action-executions/${revision}/coverage`,
        sourceId: scope.storeId,
        sourceType: "DATA_QUALITY",
        sourceVersion: null,
        label: "Déclarations de réalisation",
        value: `${entries.length} déclarations dans cette page${hasMore ? ", autres pages non consultées" : ""}. Historique privé de ce compte et de ce magasin ; une déclaration peut être restée hors connexion. Retirée ne signifie pas non-réalisation prouvée. Plusieurs déclarations peuvent concerner la même action physique : ne pas les compter comme des réalisations indépendantes. Les sources historiques peuvent être masquées ou archivées ; leur disponibilité n’est pas revalidée. Ni vérification des faits actuels du conseil, ni causalité, ni effet sur les chiffres.`,
        factKind: "QUALITY",
      },
      ...entries.map((e) => ({
        id: `action-executions/${e.id}/${e.version}`,
        sourceId: e.id,
        sourceVersion: e.version,
        sourceType: "DATA_QUALITY",
        label:
          e.status === "WITHDRAWN"
            ? "Déclaration retirée (historique)"
            : "Réalisation déclarée",
        value: `Déclaration utilisateur, non vérifiée : « ${e.snapshot.action} ». Déclarée le ${e.createdAt}${e.withdrawnAt ? `; retirée le ${e.withdrawnAt}` : ""}. ${commercialExecutionActualsSummary(e.snapshot.actuals)} Note : ${e.snapshot.notes ?? "aucune"}. Conseil historique : « ${e.snapshot.basis.quote} ». Une date de déclaration ne remplace pas la date réelle. Aucun choix d’acceptation n’est créé.`,
        factKind: "OBSERVED",
      })),
    ],
  });
}
