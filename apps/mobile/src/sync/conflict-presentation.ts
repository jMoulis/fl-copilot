import {
  commercialReviewDecisionSchema,
  synchronizedCommercialReviewDecisionSchema,
} from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "./conflict-repository";

export function conflictEntityLabel(conflict: SyncConflict) {
  const detail = payloadLabel(conflict.localPayload);
  if (detail) return detail;
  if (conflict.entityType === "product_alias")
    return payloadLabel(conflict.remotePayload) ?? "Libellé mémorisé";
  const entityLabels: Record<string, string> = {
    sync_test_entity: "Donnée de synchronisation",
    product: "Produit",
    commercial_review_decision: "Examen commercial",
    commercial_offer_choice: "Choix d’offre commerciale",
    commercial_week_preparation: "Préparation de semaine",
    commercial_execution_task: "Suivi d’exécution",
    commercial_week_plan: "Plan commercial validé",
    commercial_version_decision: "Référence PDF",
    recommendation: "Recommandation",
    decision: "Décision",
  };
  return entityLabels[conflict.entityType] ?? "Donnée locale";
}

export function conflictPayloadSummary(payload: unknown, emptyLabel: string) {
  if (payload === null || payload === undefined) return emptyLabel;
  const review = commercialReviewDecisionSchema.safeParse(payload);
  const remote = synchronizedCommercialReviewDecisionSchema.safeParse(payload);
  const decision = review.success
    ? review.data
    : remote.success
      ? remote.data.decision
      : null;
  if (decision)
    return `${decision.decision === "DISMISSED" ? "Élément écarté" : "Transcription confirmée"}${decision.corrections.length ? " · corrections saisies" : ""}`;
  return payloadLabel(payload) ?? "Version conservée pour examen.";
}

function payloadLabel(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["label", "alias", "name", "title"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
