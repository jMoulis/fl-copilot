import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  declaredActionReviewInputSchema,
  actionExecutionSchema,
  copilotEvidenceSchema,
  copilotEventsReadResultSchema,
  commercialExecutionActualsSummary,
  selectStoreEventTime,
  storeEventTimeParts,
} from "@fl-copilot/domain";
import { periodAnalysisResultSchema } from "./period-analysis-tool";
import { readActionReviewObservations } from "./action-review-tool";
import {
  serializeActionExecution,
  type ActionExecutionDocument,
} from "./action-execution-store";
export const declaredActionReviewResultSchema = z
  .strictObject({
    input: declaredActionReviewInputSchema,
    observedAt: z.string().datetime(),
    status: z.enum([
      "READY",
      "EXECUTION_UNAVAILABLE",
      "EXECUTION_CHANGED",
      "EXECUTION_WITHDRAWN",
    ]),
    declaration: actionExecutionSchema.nullable(),
    duringComparison: periodAnalysisResultSchema.nullable(),
    afterComparison: periodAnalysisResultSchema.nullable(),
    fieldEvents: copilotEventsReadResultSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(100),
  })
  .superRefine((r, c) => {
    const fail = () =>
      c.addIssue({ code: "custom", message: "Invalid declared action review" });
    const d = r.declaration,
      i = r.input;
    const status = !d
      ? "EXECUTION_UNAVAILABLE"
      : d.version !== i.expectedVersion
        ? "EXECUTION_CHANGED"
        : d.status === "WITHDRAWN"
          ? "EXECUTION_WITHDRAWN"
          : "READY";
    if (
      r.status !== status ||
      (d && d.id !== i.executionId) ||
      (i.after?.end ?? i.during.end) > storeEventTimeParts(r.observedAt).date ||
      (r.status === "READY"
        ? !r.duringComparison ||
          !r.fieldEvents ||
          !!i.after !== !!r.afterComparison
        : !!(r.duringComparison || r.afterComparison || r.fieldEvents))
    )
      fail();
    for (const [value, period] of [
      [r.duringComparison, i.during],
      [r.afterComparison, i.after],
    ] as const) {
      if (
        value &&
        (JSON.stringify(value.currentPeriod) !== JSON.stringify(period) ||
          JSON.stringify(value.referencePeriod) !== JSON.stringify(i.before) ||
          value.target.type !== "PRODUCT" ||
          value.target.productId !== i.productId ||
          value.aggregation !== i.aggregation ||
          JSON.stringify(value.coverage.map((c) => c.metric)) !==
            JSON.stringify(i.metrics))
      )
        fail();
    }
    if (r.fieldEvents) {
      const next = new Date(Date.parse(i.after?.end ?? i.during.end) + 86400000)
        .toISOString()
        .slice(0, 10);
      if (
        r.fieldEvents.productId !== i.productId ||
        r.fieldEvents.startAt !==
          selectStoreEventTime(i.before.start, "00:00") ||
        r.fieldEvents.endAt !== selectStoreEventTime(next, "00:00") ||
        r.fieldEvents.events.length > 5 ||
        r.fieldEvents.events.some(
          (e) =>
            e.event.productId !== i.productId || e.event.storeId !== d?.storeId,
        )
      )
        fail();
    }
    const nested = [
      ...(r.duringComparison?.evidence ?? []),
      ...(r.afterComparison?.evidence ?? []),
      ...(r.fieldEvents?.evidence ?? []),
    ];
    if (
      r.evidence[0]?.sourceType !== "DATA_QUALITY" ||
      r.evidence[0]?.factKind !== "QUALITY" ||
      !r.evidence[0]?.id.startsWith("declared-action-review/") ||
      JSON.stringify(r.evidence.slice(1)) !==
        JSON.stringify([...new Map(nested.map((e) => [e.id, e])).values()])
    )
      fail();
  });
/** Private contextual selection; neither a stored product association nor a causal evaluation. */
export async function readDeclaredActionReview(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
  now = new Date().toISOString(),
) {
  const target = {
    storeId: z.uuid().parse(scope.storeId),
    ownerId: z.uuid().parse(scope.ownerId),
  };
  const input = declaredActionReviewInputSchema.parse(raw);
  z.string().datetime().parse(now);
  if ((input.after?.end ?? input.during.end) > storeEventTimeParts(now).date)
    throw Error("COPILOT_ACTION_REVIEW_FUTURE");
  const load = async () => {
    const row = await db
      .collection<ActionExecutionDocument>("actionExecutions")
      .findOne({ _id: input.executionId, ...target }, { maxTimeMS: 2000 });
    if (!row) return null;
    const d = serializeActionExecution(row);
    if (
      d.id !== input.executionId ||
      d.storeId !== target.storeId ||
      d.ownerId !== target.ownerId
    )
      throw Error("COPILOT_ACTION_EXECUTION_SCOPE_INVALID");
    return d;
  };
  const declaration = await load();
  const status = !declaration
    ? "EXECUTION_UNAVAILABLE"
    : declaration.version !== input.expectedVersion
      ? "EXECUTION_CHANGED"
      : declaration.status === "WITHDRAWN"
        ? "EXECUTION_WITHDRAWN"
        : "READY";
  const observations =
    status === "READY"
      ? await readActionReviewObservations(db, target.storeId, input)
      : { duringComparison: null, afterComparison: null, fieldEvents: null };
  // A withdrawal while metrics load must invalidate this read, not return a stale realization.
  if (JSON.stringify(declaration) !== JSON.stringify(await load()))
    throw Error("COPILOT_ACTION_REVIEW_CHANGED");
  const messages = {
    READY:
      "Bilan descriptif du produit et des périodes sélectionnés à côté d’une réalisation déclarée.",
    EXECUTION_UNAVAILABLE:
      "Cette déclaration n’est pas disponible pour ce compte et ce magasin ; elle peut être restée hors connexion.",
    EXECUTION_CHANGED:
      "Cette déclaration a changé ; relisez son état avant de reprendre ce bilan.",
    EXECUTION_WITHDRAWN:
      "Cette déclaration a été retirée ; elle reste historique et aucun bilan n’est calculé en son nom.",
  };
  const qualification = [
    messages[status],
    `Consulté au ${now}, dates métier Europe/Paris.`,
    declaration
      ? `Déclaration utilisateur non vérifiée : « ${declaration.snapshot.action} ». Déclarée le ${declaration.createdAt}. Conseil historique : « ${declaration.snapshot.basis.quote} ». ${commercialExecutionActualsSummary(declaration.snapshot.actuals)} Note : ${declaration.snapshot.notes ?? "aucune"}.`
      : "",
    "Le produit est sélectionné pour ce bilan seulement : aucune association avec le conseil n’est validée ou enregistrée. Une date de déclaration n’est pas une date réelle d’exécution. Les périodes explicites ne sont pas remplacées par les dates déclarées. Aucune acceptation, tâche commerciale ou recommandation éligible n’est créée. Les faits actuels et la disponibilité de la source historique ne sont pas revalidés.",
    declaration?.snapshot.actuals?.start &&
    (input.during.start < declaration.snapshot.actuals.start ||
      (declaration.snapshot.actuals.end &&
        input.during.end > declaration.snapshot.actuals.end))
      ? "La fenêtre pendant déborde les dates réelles déclarées : ce bilan n’isole pas la durée de réalisation renseignée."
      : "",
    status === "READY"
      ? `Comparaisons à avant séparées ; durées et jours de semaine peuvent différer. Données manquantes inconnues, jamais zéro ; couverture partielle conservée. ${input.after ? "" : "Période après non demandée : aucun résultat après observé."} ${(input.after?.end ?? input.during.end) === storeEventTimeParts(now).date ? "La journée en cours peut être incomplète." : ""} Signalements produit consultés sur la fenêtre entière, y compris ses intervalles, cinq au plus ; vérifier dates et pagination. Aucune alerte ne prouve pas l’absence de rupture. Stock, météo, trafic, prix effectifs et autres promotions ne sont pas contrôlés. Déclaration et variation observée ne démontrent ni causalité, ni gain incrémental, ni ROI.`
      : "Aucune analyse de chiffres ni de signalements n’a été effectuée.",
  ]
    .filter(Boolean)
    .join(" ");
  const revision = createHash("sha256")
    .update(JSON.stringify([target, input, now, declaration, observations]))
    .digest("hex");
  const evidence = [
    {
      id: `declared-action-review/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: declaration?.id ?? target.storeId,
      sourceVersion: declaration?.version ?? null,
      label: "Périmètre du bilan de réalisation déclarée",
      value: qualification,
      factKind: "QUALITY",
    },
    ...(observations.duringComparison?.evidence ?? []),
    ...(observations.afterComparison?.evidence ?? []),
    ...(observations.fieldEvents?.evidence ?? []),
  ];
  return declaredActionReviewResultSchema.parse({
    input,
    observedAt: now,
    status,
    declaration,
    ...observations,
    evidence: [...new Map(evidence.map((e) => [e.id, e])).values()],
  });
}
