import type { SyncConflict } from "./conflict-repository";

export function conflictEntityLabel(conflict: SyncConflict) {
  const detail = payloadLabel(conflict.localPayload);
  if (detail) return detail;
  if (conflict.entityType === "product_alias")
    return payloadLabel(conflict.remotePayload) ?? "Libellé mémorisé";
  const entityLabels: Record<string, string> = {
    sync_test_entity: "Donnée de synchronisation",
    product: "Produit",
    recommendation: "Recommandation",
    decision: "Décision",
  };
  return entityLabels[conflict.entityType] ?? "Donnée locale";
}

export function conflictPayloadSummary(payload: unknown, emptyLabel: string) {
  if (payload === null || payload === undefined) return emptyLabel;
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
