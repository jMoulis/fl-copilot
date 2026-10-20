import { commercialExecutionActualsSummary } from "@fl-copilot/domain";
import type {
  CommercialExecutionTask,
  CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import { commercialMechanismDescription } from "./choice-presentation";
export function executionTaskContext(
  plan: CommercialWeekPlan,
  targetId: string,
) {
  const offer = plan.offers.find((o) => o.id === targetId);
  if (offer)
    return `Affiche · ${commercialMechanismDescription(offer.customerMechanism)}. À vérifier avant impression.`;
  const tg = plan.preparation.placements.find((t) => t.id === targetId);
  return tg
    ? plan.offers
        .filter((o) => tg.offerIds.includes(o.choiceId))
        .map((o) => o.rawProductLabel)
        .join(" · ")
    : "";
}
export const executionStatusLabels = {
  TODO: "À faire",
  DONE: "Fait",
  SKIPPED: "Ignoré",
  NOT_APPLICABLE: "Non applicable",
};
export function commercialExecutionSummary(t: CommercialExecutionTask) {
  return `${t.label} · plan version ${t.planVersion}\n${executionStatusLabels[t.status]}${t.completedAt ? ` · déclaré le ${new Date(t.completedAt).toLocaleString("fr-FR")}` : ""}${t.note ? `\n${t.note}` : ""}\n${commercialExecutionActualsSummary(t.actuals)}`;
}
export function commercialExecutionError(code: string | undefined) {
  return (
    (
      {
        COMMERCIAL_EXECUTION_ACTUALS_INVALID:
          "Vérifiez les dates réelles (sans date future), le prix et son unité.",
        COMMERCIAL_EXECUTION_PLAN_CHANGED:
          "La déclaration ne correspond pas à la copie confirmée du plan. Elle reste conservée sur cet appareil ; revoyez le plan et ses tâches avant de la rattacher à une autre version.",
        COMMERCIAL_EXECUTION_RESOLVE_REQUIRED:
          "Comparez les deux déclarations dans Synchronisation avant de modifier cette tâche.",
        COMMERCIAL_EXECUTION_REVISION_INVALID:
          "La tâche a changé. Rouvrez sa modification avant d’enregistrer votre statut.",
        COMMERCIAL_EXECUTION_SYNCING:
          "La déclaration s’envoie. Attendez la fin de la synchronisation avant de résoudre ce conflit.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Le statut n’a pas pu être enregistré. Vérifiez la note ou rouvrez la modification de cette tâche."
  );
}
