import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotActionReviewInputSchema,
  copilotEvidenceSchema,
  executionProposalSchema,
  commercialExecutionTaskSchema,
  copilotEventsReadResultSchema,
  mergeBusinessPeriods,
  selectStoreEventTime,
  storeEventTimeParts,
  commercialExecutionTargetMatches,
  recommendationDecisionReadResultSchema,
} from "@fl-copilot/domain";
import { readExecutionContext } from "./commercial-plan-tool.js";
import {
  readPeriodAnalysis,
  periodAnalysisResultSchema,
} from "./period-analysis-tool.js";
import { readFieldEvents } from "./field-events-tool.js";
import { readRecommendationDecisions } from "./decision-read-tool.js";
const inputSchema = copilotActionReviewInputSchema;
function decisionReadInput(recommendationId: string) {
  return { conversationId: null, recommendationId, afterId: null, limit: 1 };
}
type DecisionContext = z.infer<typeof recommendationDecisionReadResultSchema>;
function decisionIssue(
  input: z.infer<typeof inputSchema>,
  context?: DecisionContext | null,
) {
  if (!input.decision) return null;
  const entry = context?.entries[0];
  return !entry
    ? ("DECISION_UNAVAILABLE" as const)
    : entry.version !== input.decision.expectedVersion
      ? ("DECISION_CHANGED" as const)
      : entry.sourceState === "UNAVAILABLE" || !entry.basis
        ? ("DECISION_SOURCE_UNAVAILABLE" as const)
        : null;
}
export const actionReviewResultSchema = z
  .strictObject({
    input: inputSchema,
    observedAt: z.string().datetime(),
    status: z.enum([
      "READY",
      "NO_PLAN",
      "LIMIT_EXCEEDED",
      "TASK_UNAVAILABLE",
      "PRODUCT_NOT_IN_TASK",
      "PERIOD_OUTSIDE_OFFER",
      "DECISION_UNAVAILABLE",
      "DECISION_CHANGED",
      "DECISION_SOURCE_UNAVAILABLE",
    ]),
    decisionContext: recommendationDecisionReadResultSchema
      .nullable()
      .optional(),
    task: z
      .strictObject({
        proposal: executionProposalSchema,
        declaration: commercialExecutionTaskSchema.nullable(),
      })
      .nullable(),
    duringComparison: periodAnalysisResultSchema.nullable(),
    afterComparison: periodAnalysisResultSchema.nullable(),
    fieldEvents: copilotEventsReadResultSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(103),
  })
  .superRefine((r, c) => {
    const fail = () =>
      c.addIssue({
        code: "custom",
        message: "Invalid action review scope or coverage",
      });
    const i = r.input;
    if (
      !inputSchema.safeParse(i).success ||
      !Number.isFinite(Date.parse(r.observedAt))
    ) {
      fail();
      return;
    }
    const context = r.decisionContext;
    const issue = decisionIssue(i, context);
    if (
      !!i.decision !== !!context ||
      (context &&
        (!i.decision ||
          JSON.stringify(context.input) !==
            JSON.stringify(decisionReadInput(i.decision!.recommendationId)) ||
          context.status !== "READY" ||
          context.hasMore ||
          context.nextAfterId !== null ||
          context.entries.length > 1 ||
          context.evidence.length !== context.entries.length + 1 ||
          context.entries.some(
            (e) => e.id !== i.decision!.recommendationId,
          ))) ||
      (issue ? r.status !== issue : r.status.startsWith("DECISION_"))
    )
      fail();
    if (
      (r.status === "READY") !== !!(r.duringComparison && r.fieldEvents) ||
      (r.status !== "READY" &&
        (r.duringComparison || r.afterComparison || r.fieldEvents)) ||
      (r.status === "READY" && !!i.after !== !!r.afterComparison) ||
      ([
        "NO_PLAN",
        "LIMIT_EXCEEDED",
        "TASK_UNAVAILABLE",
        "DECISION_UNAVAILABLE",
        "DECISION_CHANGED",
        "DECISION_SOURCE_UNAVAILABLE",
      ].includes(r.status)
        ? r.task !== null
        : r.task === null) ||
      (r.task &&
        (r.task.proposal.id !== i.taskId ||
          (r.task.declaration &&
            !commercialExecutionTargetMatches(
              r.task.declaration,
              r.task.proposal,
            )))) ||
      (i.after?.end ?? i.during.end) > storeEventTimeParts(r.observedAt).date
    )
      fail();
    for (const [result, period] of [
      [r.duringComparison, i.during],
      [r.afterComparison, i.after],
    ] as const) {
      if (
        result &&
        (JSON.stringify(result.currentPeriod) !== JSON.stringify(period) ||
          JSON.stringify(result.referencePeriod) !== JSON.stringify(i.before) ||
          result.target.productId !== i.productId ||
          result.target.type !== "PRODUCT" ||
          result.aggregation !== i.aggregation ||
          JSON.stringify(result.coverage.map((c) => c.metric)) !==
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
        r.fieldEvents.events.some((e) => e.event.productId !== i.productId)
      )
        fail();
    }
    const nested = [
      ...(context?.evidence ?? []),
      ...(r.duringComparison?.evidence ?? []),
      ...(r.afterComparison?.evidence ?? []),
      ...(r.fieldEvents?.evidence ?? []),
    ];
    const expected = [...new Map(nested.map((e) => [e.id, e])).values()];
    if (
      r.evidence[0]?.sourceType !== "DATA_QUALITY" ||
      r.evidence[0]?.factKind !== "QUALITY" ||
      !r.evidence[0]?.id.startsWith("action-review/") ||
      JSON.stringify(r.evidence.slice(1)) !== JSON.stringify(expected)
    )
      fail();
  });
export type ActionReviewResult = z.infer<typeof actionReviewResultSchema>;
/** A bounded read of a current saved task, not a persistent causal evaluation. */
export async function readActionReview(
  db: Db,
  storeId: string,
  raw: unknown,
  now = new Date().toISOString(),
  ownerId?: string,
): Promise<ActionReviewResult> {
  z.uuid().parse(storeId);
  const input = inputSchema.parse(raw);
  z.string().datetime().parse(now);
  const today = storeEventTimeParts(now).date;
  if ((input.after?.end ?? input.during.end) > today)
    throw Error("COPILOT_ACTION_REVIEW_FUTURE");
  if (input.decision && !z.uuid().safeParse(ownerId).success)
    throw Error("COPILOT_ACTION_REVIEW_FORBIDDEN");
  const decisionContext = input.decision
    ? await readRecommendationDecisions(
        db,
        { storeId, ownerId: ownerId! },
        decisionReadInput(input.decision.recommendationId),
      )
    : null;
  const issue = decisionIssue(input, decisionContext);
  const context = issue
    ? { p: null, proposals: [], records: [], matched: [], exceeded: false }
    : await readExecutionContext(db, storeId, input.weekStart);
  const { p, proposals, records, matched, exceeded } = context;
  const proposal = proposals.find((t) => t.id === input.taskId);
  const declaration = matched.find((t) => t.id === input.taskId) ?? null;
  let status: ActionReviewResult["status"] =
    issue ??
    (!p
      ? "NO_PLAN"
      : exceeded
        ? "LIMIT_EXCEEDED"
        : !proposal ||
            records.some((t) => t.id === input.taskId && !matched.includes(t))
          ? "TASK_UNAVAILABLE"
          : "READY");
  const task = status === "READY" ? { proposal: proposal!, declaration } : null;
  const offers = !task
    ? []
    : p!.offers.filter(
        (o) =>
          o.productId === input.productId &&
          (task.proposal.kind === "PRINT_SIGNAGE"
            ? o.id === task.proposal.targetId
            : p!.preparation.placements.some(
                (t) =>
                  t.id === task.proposal.targetId &&
                  t.offerIds.includes(o.choiceId),
              )),
      );
  if (status === "READY" && !offers.length) status = "PRODUCT_NOT_IN_TASK";
  const offerPeriods = mergeBusinessPeriods(
    offers.map((o) => ({ start: o.saleStart, end: o.saleEnd })),
  );
  if (
    status === "READY" &&
    !offerPeriods.some(
      (p) => p.start <= input.during.start && p.end >= input.during.end,
    )
  )
    status = "PERIOD_OUTSIDE_OFFER";
  let duringComparison: ActionReviewResult["duringComparison"] = null;
  let afterComparison: ActionReviewResult["afterComparison"] = null;
  let fieldEvents: ActionReviewResult["fieldEvents"] = null;
  if (status === "READY") {
    const nextDate = new Date(
      Date.parse(input.after?.end ?? input.during.end) + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    [duringComparison, afterComparison, fieldEvents] = await Promise.all([
      readPeriodAnalysis(db, storeId, {
        productId: input.productId,
        currentPeriod: input.during,
        referencePeriod: input.before,
        aggregation: input.aggregation,
        metrics: input.metrics,
      }),
      input.after
        ? readPeriodAnalysis(db, storeId, {
            productId: input.productId,
            currentPeriod: input.after,
            referencePeriod: input.before,
            aggregation: input.aggregation,
            metrics: input.metrics,
          })
        : Promise.resolve(null),
      readFieldEvents(db, storeId, {
        productId: input.productId,
        startAt: selectStoreEventTime(input.before.start, "00:00"),
        endAt: selectStoreEventTime(nextDate, "00:00"),
        afterId: null,
        limit: 5,
      }),
    ]);
    // Do not label a concurrent plan/declaration revision as the reviewed action.
    const latest = await readExecutionContext(db, storeId, input.weekStart);
    if (
      JSON.stringify([p, records]) !==
      JSON.stringify([latest.p, latest.records])
    )
      throw Error("COPILOT_ACTION_REVIEW_CHANGED");
    // Reference values/coverage must agree across the two bounded canonical reads.
    const reference = (
      r: NonNullable<ActionReviewResult["duringComparison"]>,
    ) => ({
      coverage: r.coverage.map((c) => [c.metric, c.reference]),
      values: r.evidence
        .filter((e) =>
          ["reference", "reference-coverage"].includes(JSON.parse(e.id).at(-1)),
        )
        .map((e) => [e.label, e.value, e.detail]),
      wasteRate: r.wasteRates?.[1] ?? null,
    });
    if (
      afterComparison &&
      JSON.stringify(reference(duringComparison)) !==
        JSON.stringify(reference(afterComparison))
    )
      throw Error("COPILOT_ACTION_REVIEW_CHANGED");
  }
  // Refuse changes to the choice, its source visibility or basis during the read.
  // No relationship is written from the model's selection of these two records.
  if (
    input.decision &&
    JSON.stringify(decisionContext) !==
      JSON.stringify(
        await readRecommendationDecisions(
          db,
          { storeId, ownerId: ownerId! },
          decisionReadInput(input.decision.recommendationId),
        ),
      )
  )
    throw Error("COPILOT_ACTION_REVIEW_CHANGED");
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        now,
        p,
        records,
        offers,
        decisionContext,
        duringComparison,
        afterComparison,
        fieldEvents,
      ]),
    )
    .digest("hex");
  const messages: Record<ActionReviewResult["status"], string> = {
    READY:
      "Bilan descriptif des périodes explicites pour un produit de la tâche enregistrée.",
    NO_PLAN:
      "Aucun plan synchronisé pour cette semaine ; un plan local peut exister.",
    LIMIT_EXCEEDED:
      "Trop de déclarations pour examiner complètement la tâche ; aucun bilan calculé sur un échantillon.",
    TASK_UNAVAILABLE:
      "Cette tâche ne correspond plus à la révision courante du plan. Reconsultez le plan ; aucune ancienne déclaration n’est transférée.",
    PRODUCT_NOT_IN_TASK:
      "Le produit n’est pas associé à cette tâche dans le plan enregistré. Précisez le produit ou la tâche.",
    PERIOD_OUTSIDE_OFFER:
      "La période pendant dépasse les dates des offres enregistrées de ce produit pour cette tâche. Précisez la période ; aucune date d’exécution n’est déduite.",
    DECISION_UNAVAILABLE:
      "Ce choix n’est pas disponible pour ce compte et ce magasin. Il peut être resté sur un appareil ; aucun bilan n’est calculé en son nom.",
    DECISION_CHANGED:
      "Votre choix a changé depuis sa consultation. Relisez la dernière décision avant de demander ce bilan.",
    DECISION_SOURCE_UNAVAILABLE:
      "Le conseil d’origine n’est plus vérifiable. Le choix conservé reste consultable, mais ce bilan doit être repris depuis une source utilisable.",
  };
  const qualification = [
    messages[status],
    `Consulté au ${now} ; les périodes métier sont en Europe/Paris.`,
    input.decision
      ? "Le choix privé et la tâche sont sélectionnés pour ce bilan uniquement : aucun lien durable ni correspondance métier n’est validé ou enregistré. Un choix accepté, modifié, reporté ou refusé ne prouve pas l’exécution de cette tâche ; le contexte du conseil n’est pas revalidé. Un choix enregistré après les périodes observées n’est pas un plan préalable à l’action."
      : "",
    task
      ? `Tâche : ${task.proposal.label} ; plan version ${task.proposal.planVersion}, révision ${task.proposal.planRevisionId}. ${declaration ? `Déclaration utilisateur : ${declaration.status}, version ${declaration.version}, date déclarée ${declaration.completedAt ?? "non renseignée"}, note : ${declaration.note || "aucune"}.` : "Aucune déclaration correspondante : À faire, réalisation inconnue."}`
      : "",
    "Plan enregistré et déclaration ne prouvent ni installation réelle ni effet commercial. Une date de déclaration n’est pas la durée d’exposition. Une affiche imprimée n’est pas une TG installée. Les sources actuelles du plan ne sont pas revalidées.",
    status === "READY"
      ? `Périodes pendant/après comparées séparément à avant, agrégation ${input.aggregation}. Durées et jours de semaine peuvent différer ; ne pas comparer des cumuls de durées différentes comme une performance équivalente. Les manques restent inconnus, jamais zéro. ${input.after ? "" : "Période après non demandée : aucun résultat après observé."} ${(input.after?.end ?? input.during.end) === today ? "La journée en cours peut être incomplète." : ""} Signalements produit consultés sur l’ensemble de la fenêtre, y compris ses éventuels intervalles ; vérifier leur chevauchement avec chaque période. L’absence de signalement ne prouve pas l’absence de rupture. Météo, trafic, autres promotions, prix effectifs, stock et cannibalisation ne sont pas contrôlés par ce bilan. Une variation descriptive ne démontre ni causalité, ni gain incrémental, ni ROI.`
      : "Aucune analyse de chiffres ni de signalement n’a été effectuée.",
  ]
    .filter(Boolean)
    .join(" ");
  const evidence = [
    copilotEvidenceSchema.parse({
      id: `action-review/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: task?.proposal.id ?? storeId,
      sourceVersion: task?.proposal.planVersion ?? null,
      label: "Périmètre et limites du bilan de mise en place",
      value: qualification,
      factKind: "QUALITY",
    }),
    ...(decisionContext?.evidence ?? []),
    ...(duringComparison?.evidence ?? []),
    ...(afterComparison?.evidence ?? []),
    ...(fieldEvents?.evidence ?? []),
  ];
  return actionReviewResultSchema.parse({
    input,
    observedAt: now,
    status,
    task,
    decisionContext,
    duringComparison,
    afterComparison,
    fieldEvents,
    evidence: [...new Map(evidence.map((e) => [e.id, e])).values()],
  });
}
