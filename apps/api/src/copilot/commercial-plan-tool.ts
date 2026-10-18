import {
  copilotExecutionPreviewInputSchema,
  copilotExecutionPreviewResultSchema,
} from "@fl-copilot/domain";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotPlanReadInputSchema,
  copilotPlanReadResultSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  commercialExecutionChecklist,
  commercialExecutionPlanChecksum,
  commercialExecutionSameTarget,
  commercialExecutionProgress,
  commercialMechanismDescription,
} from "@fl-copilot/commercial-core";
import {
  serializeCommercialPlan,
  type WeekPlanDocument,
} from "../commercial/week-plan-sync.js";
import {
  serializeCommercialExecution,
  type ExecutionTaskDocument,
} from "../commercial/execution-sync.js";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
const taskShape = copilotPlanReadResultSchema.shape.tasks.element.shape;
const operationProjection = taskShape.operation.unwrap().strip();
const placementOfferProjection = taskShape.placementOffers.element.strip();
const mechanism = (m: Parameters<typeof commercialMechanismDescription>[0]) =>
  commercialMechanismDescription(m) +
  (m.type === "CARD_BENEFIT" && m.scope ? " ; portée carte : " + m.scope : "");
export async function readExecutionContext(
  db: Db,
  storeId: string,
  weekStart: string,
) {
  const row = await db
    .collection<WeekPlanDocument>("commercialWeekPlans")
    .findOne({ storeId, weekStart }, { maxTimeMS: 2000 });
  const p = row ? serializeCommercialPlan(row) : null;
  if (
    p &&
    (row!._id !== p.id || p.storeId !== storeId || p.weekStart !== weekStart)
  )
    throw Error("COPILOT_PLAN_SCOPE_INVALID");
  const proposals = p ? await commercialExecutionChecklist(p, digest) : [];
  const rows = p
    ? await db
        .collection<ExecutionTaskDocument>("commercialExecutionTasks")
        .find({ storeId, planRevisionId: p.revisionId })
        .sort({ _id: 1 })
        .maxTimeMS(2000)
        .limit(131)
        .toArray()
    : [];
  const records = rows.map((r) => {
    const t = serializeCommercialExecution(r);
    if (
      r._id !== t.id ||
      t.storeId !== storeId ||
      t.planRevisionId !== p!.revisionId ||
      t.planId !== p!.id
    )
      throw Error("COPILOT_PLAN_SCOPE_INVALID");
    return t;
  });
  const exceeded = records.length > 130;
  const status = !p
    ? ("NO_PLAN" as const)
    : exceeded
      ? ("LIMIT_EXCEEDED" as const)
      : ("READY" as const);
  const matched = exceeded
    ? []
    : records.filter((r) =>
        proposals.some((t) => commercialExecutionSameTarget(r, t)),
      );
  return { p, proposals, records, matched, exceeded, status };
}
export async function readCommercialPlan(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = copilotPlanReadInputSchema.parse(raw);
  const { p, proposals, records, matched, exceeded, status } =
    await readExecutionContext(db, storeId, input.weekStart);
  const page = exceeded
    ? []
    : proposals.slice(input.offset, input.offset + input.limit);
  const tasks = page.map((proposal) => {
    const offer =
      p!.offers.find(
        (o) => proposal.kind === "PRINT_SIGNAGE" && o.id === proposal.targetId,
      ) ?? null;
    const operation = offer
      ? p!.operations.find((o) => o.id === offer.operationId)!
      : null;
    const placement =
      proposal.kind === "INSTALL_TG"
        ? (p!.preparation.placements.find((t) => t.id === proposal.targetId) ??
          null)
        : null;
    return {
      proposal,
      record:
        matched.find((r) => commercialExecutionSameTarget(r, proposal)) ?? null,
      offer,
      operation: operation ? operationProjection.parse(operation) : null,
      placement,
      placementOffers: placement
        ? p!.offers
            .filter((o) => placement.offerIds.includes(o.choiceId))
            .map((o) => placementOfferProjection.parse(o))
        : [],
    };
  });
  const plan = p
    ? {
        id: p.id,
        revisionId: p.revisionId,
        version: p.version,
        checksum: await commercialExecutionPlanChecksum(p, digest),
        weekStart: p.weekStart,
        weekEnd: p.weekEnd,
        validatedAt: p.validatedAt,
        tgCapacity: p.preparation.tgCapacity,
        note: p.preparation.note,
      }
    : null;
  const progress =
    p && !exceeded ? commercialExecutionProgress(proposals, matched) : null;
  const nextOffset =
    p && !exceeded && input.offset + page.length < proposals.length
      ? input.offset + page.length
      : null;
  const unmatchedDeclarations =
    p && !exceeded ? records.length - matched.length : null;
  const revision = createHash("sha256")
    .update(JSON.stringify([storeId, input, p, records]))
    .digest("hex");
  const evidence: z.infer<typeof copilotEvidenceSchema>[] = [];
  const states = {
    TODO: "À faire",
    DONE: "Déclarée faite",
    SKIPPED: "Ignorée avec motif",
    NOT_APPLICABLE: "Non applicable avec motif",
  };
  const date = (s: string) =>
    new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    }).format(new Date(s));
  const fact = (
    key: string,
    label: string,
    value: string,
    kind: "OBSERVED" | "PLANNED" | "QUALITY",
    sourceId = plan?.id ?? storeId,
    version: number | null = plan?.version ?? null,
  ) =>
    copilotEvidenceSchema.parse({
      id: `commercial-plan/${revision}/${key}`,
      sourceType: kind === "QUALITY" ? "DATA_QUALITY" : "COMMERCIAL_OPERATION",
      sourceId,
      sourceVersion: version,
      label,
      value,
      factKind: kind,
    });
  for (const t of tasks) {
    const r = t.record;
    const value = `${r ? states[r.status] : "À faire, aucune déclaration correspondante"}.${r?.completedAt ? " Déclarée faite le " + date(r.completedAt) + " (Europe/Paris)." : ""}${r?.note ? " Note utilisateur : " + r.note : ""} ${t.offer ? `Offre prévue : ${t.offer.rawProductLabel} ; ${mechanism(t.offer.customerMechanism)} ; du ${t.offer.saleStart} au ${t.offer.saleEnd} ; ${t.operation!.name} (${t.operation!.kind}).` : `TG prévue : ${t.placement!.label} ; thème ${t.placement!.theme || "non précisé"} ; ${t.placement!.offerIds.length} offres associées dans le plan : ${t.placementOffers.map((o) => o.rawProductLabel + " — " + mechanism(o.customerMechanism)).join(" ; ") || "aucune"}.`} Une déclaration est un enregistrement utilisateur, pas une preuve automatique d'impression ou d'installation en rayon.`;
    evidence.push(
      fact(
        t.proposal.id,
        t.proposal.label,
        value,
        r ? "OBSERVED" : "PLANNED",
        r?.id ?? t.proposal.targetId,
        r?.version ?? plan!.version,
      ),
    );
  }
  evidence.push(
    fact(
      "plan",
      "Plan commercial enregistré",
      p
        ? `Version ${p.version}, validée le ${date(p.validatedAt)} (Europe/Paris), semaine du ${p.weekStart} au ${p.weekEnd}. ${p.offers.length} offres, ${p.preparation.placements.length} TG prévues, capacité déclarée ${p.preparation.tgCapacity ?? "inconnue"}.${p.preparation.note ? " Note : " + p.preparation.note : ""} Lecture du plan enregistré ; les sources et références actuelles n'ont pas été revalidées ici. Plan validé ne signifie pas installé ou exécuté.`
        : "Aucun plan validé synchronisé pour cette semaine. Cela ne prouve pas qu'il n'y a rien à préparer, ni qu'une préparation locale n'existe pas.",
      p ? "PLANNED" : "QUALITY",
    ),
  );
  evidence.push(
    fact(
      "coverage",
      "Suivi des déclarations commerciales",
      progress
        ? `${progress.total} tâches prévues : ${progress.TODO} à faire, ${progress.DONE} déclarées faites, ${progress.SKIPPED} ignorées, ${progress.NOT_APPLICABLE} non applicables. ${tasks.length} tâches dans cette page${nextOffset !== null ? ", autres pages non consultées" : ""}. ${unmatchedDeclarations} déclarations de cette révision ne correspondent pas aux cibles actuelles et ne sont pas appliquées. Les anciennes révisions ne sont pas transférées. Ce suivi n'établit ni réalisation automatique, ni effet commercial ou causal sur les ventes.`
        : exceeded
          ? "Limite de lecture dépassée ; progression indisponible, aucun compte n'est calculé sur un échantillon."
          : "Progression indisponible sans plan enregistré ; elle n'est pas zéro.",
      "QUALITY",
    ),
  );
  return copilotPlanReadResultSchema.parse({
    weekStart: input.weekStart,
    status,
    plan,
    tasks,
    progress,
    unmatchedDeclarations,
    nextOffset,
    evidence,
  });
}

/** Preparation only: stable current task identity/revision, never an execution write. */
export async function readCommercialExecutionPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = copilotExecutionPreviewInputSchema.parse(raw);
  const { p, proposals, records, matched, exceeded } =
    await readExecutionContext(db, storeId, input.weekStart);
  const proposal = exceeded
    ? undefined
    : proposals.find((t) => t.id === input.taskId);
  const before = proposal
    ? (matched.find((r) => commercialExecutionSameTarget(r, proposal)) ?? null)
    : null;
  // An existing same ID with drifted target must never be treated as a missing declaration.
  const drifted =
    proposal &&
    records.some(
      (r) =>
        r.id === proposal.id && !commercialExecutionSameTarget(r, proposal),
    );
  const status = !p
    ? "NO_PLAN"
    : exceeded
      ? "LIMIT_EXCEEDED"
      : !proposal || drifted
        ? "TASK_UNAVAILABLE"
        : before?.status === input.status && before.note === input.note
          ? "UNCHANGED"
          : "READY";
  const preview =
    proposal && ["READY", "UNCHANGED"].includes(status)
      ? { proposal, before }
      : null;
  const revision = createHash("sha256")
    .update(JSON.stringify([storeId, input, preview, status]))
    .digest("hex");
  return copilotExecutionPreviewResultSchema.parse({
    input,
    status,
    preview,
    evidence: [
      {
        id: `execution-preview/${revision}`,
        sourceId: proposal?.id ?? storeId,
        sourceType: "COMMERCIAL_OPERATION",
        sourceVersion: p?.version ?? null,
        label: proposal?.label ?? "Déclaration commerciale indisponible",
        value:
          status === "READY"
            ? "Déclaration préparée, à confirmer sur l’appareil. Aucun enregistrement effectué."
            : status === "UNCHANGED"
              ? "Cette déclaration est déjà enregistrée avec le même statut et la même note."
              : "Le plan ou la tâche courante n’est pas disponible pour préparer cette déclaration.",
        factKind: status === "UNCHANGED" ? "OBSERVED" : "PLANNED",
      },
    ],
  });
}
