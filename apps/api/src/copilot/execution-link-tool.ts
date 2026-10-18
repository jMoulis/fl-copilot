import { legacyCommercialExecution } from "@fl-copilot/domain";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  executionLinkInputSchema,
  executionLinkPreviewSchema,
  executionLinksReadInputSchema,
  executionLinksReadResultSchema,
  copilotExecutionLinkSchema,
} from "@fl-copilot/domain";
import { readRecommendationDecisions } from "./decision-read-tool.js";
import { readExecutionContext } from "./commercial-plan-tool.js";
export async function readExecutionLinkPreview(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
) {
  const input = executionLinkInputSchema.parse(raw);
  const decision = await readRecommendationDecisions(db, scope, {
    conversationId: null,
    recommendationId: input.recommendationId,
    afterId: null,
    limit: 1,
  });
  const entry = decision.entries[0];
  let status: z.infer<typeof executionLinkPreviewSchema>["status"] = !entry
    ? "DECISION_UNAVAILABLE"
    : entry.version !== input.decisionVersion
      ? "DECISION_CHANGED"
      : !entry.basis || entry.sourceState === "UNAVAILABLE"
        ? "SOURCE_UNAVAILABLE"
        : "READY";
  const context =
    status === "READY"
      ? await readExecutionContext(db, scope.storeId, input.weekStart)
      : null;
  const task = context?.matched.find((t) => t.id === input.taskId);
  if (status === "READY")
    status =
      !context?.p || context.exceeded || !task
        ? "TASK_UNAVAILABLE"
        : task.version !== input.taskVersion
          ? "TASK_CHANGED"
          : "READY";
  const snapshot =
    status === "READY"
      ? {
          decision: {
            id: entry!.id,
            version: entry!.version,
            conversationId: entry!.conversationId,
            revision: entry!.latest,
            basis: entry!.basis,
          },
          weekStart: input.weekStart,
          task: legacyCommercialExecution(task!),
        }
      : null;
  const digest = createHash("sha256")
    .update(JSON.stringify([scope, input, status, snapshot]))
    .digest("hex");
  return executionLinkPreviewSchema.parse({
    input,
    status,
    snapshot,
    evidence: [
      ...decision.evidence,
      {
        id: `execution-link-preview/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.taskId,
        sourceVersion: task?.version ?? null,
        label: "Association à confirmer",
        value:
          status === "READY"
            ? "Vous pouvez associer ce choix précis à cette version de la déclaration. Le lien reste privé et nécessite une confirmation. Il ne modifie ni décision, ni tâche, ni chiffres ; une déclaration n’est pas une preuve de réalisation ni d’effet commercial. Les faits du conseil ne sont pas revalidés."
            : "L’association n’est pas prête : relisez le choix ou la déclaration synchronisée. Aucune action ni association n’a été enregistrée.",
        factKind: "QUALITY",
      },
    ],
  });
}
export async function readExecutionLinks(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
) {
  z.uuid().parse(scope.storeId);
  z.uuid().parse(scope.ownerId);
  const input = executionLinksReadInputSchema.parse(raw);
  const rows = await db
    .collection<{ _id: string; [key: string]: unknown }>(
      "copilotExecutionLinks",
    )
    .find({
      ...scope,
      ...(input.recommendationId
        ? { "snapshot.decision.id": input.recommendationId }
        : {}),
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const all = rows.map(({ _id, ...payload }) => {
    const e = copilotExecutionLinkSchema.parse(payload);
    if (
      e.id !== _id ||
      e.storeId !== scope.storeId ||
      e.ownerId !== scope.ownerId
    )
      throw Error("COPILOT_EXECUTION_LINK_SCOPE_INVALID");
    return e;
  });
  const entries = all.slice(0, input.limit),
    hasMore = all.length > input.limit;
  const digest = createHash("sha256")
    .update(JSON.stringify([scope, input, entries, hasMore]))
    .digest("hex");
  return executionLinksReadResultSchema.parse({
    input,
    entries,
    hasMore,
    nextAfterId: hasMore ? entries.at(-1)!.id : null,
    evidence: [
      ...entries.map((e) => ({
        id: `execution-link/${e.id}/v${e.version}/${digest}`,
        sourceType: "EVENT",
        sourceId: e.id,
        sourceVersion: e.version,
        label: "Votre suivi de mise en place",
        value: `Lien ${e.version === 2 ? "retiré le " + e.withdrawnAt : "confirmé le " + e.createdAt}. Choix ${e.snapshot.decision.revision.type}, version ${e.snapshot.decision.version} : « ${e.snapshot.decision.revision.modifiedAction ?? e.snapshot.decision.basis.quote} ». Déclaration liée : ${e.snapshot.task.label}, statut ${e.snapshot.task.status}, version ${e.snapshot.task.version}, date déclarée ${e.snapshot.task.completedAt ?? "non renseignée"}. Il s’agit des versions conservées lors du lien, pas forcément des versions actuelles. Une association ne prouve ni réalisation physique ni causalité ; un lien retiré ne doit pas être utilisé comme association active.`,
        factKind: "OBSERVED",
      })),
      {
        id: `execution-link-coverage/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: scope.storeId,
        sourceVersion: null,
        label: "Couverture des associations privées",
        value: `${entries.length} associations synchronisées dans cette page${hasMore ? " ; autres pages à consulter" : ""}. Ordre des identifiants, pas chronologique. Les liens restés sur un appareil peuvent manquer. Les versions liées ne revalident pas le conseil et ne remplacent pas la déclaration courante.`,
        factKind: "QUALITY",
      },
    ],
  });
}
