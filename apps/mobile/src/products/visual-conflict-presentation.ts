import type { VisualEntityMap, VisualEntityType } from "@fl-copilot/domain";
export function visualConflictSummary(
  entity: VisualEntityMap[VisualEntityType],
  labels: Record<string, string>,
) {
  const lines: string[] = [];
  if ("contentHash" in entity) {
    lines.push(
      {
        PENDING: "Image à examiner",
        APPROVED: "Image approuvée",
        REJECTED: "Image refusée",
        REVOKED: "Image retirée de la diffusion",
      }[entity.review.status],
    );
    const p = entity.provenance;
    lines.push(
      p.type === "USER_UPLOAD"
        ? "Photo ajoutée par le magasin · droits déclarés"
        : p.type === "AI_GENERATED"
          ? `Illustration IA · ${p.provider} · ${p.model}`
          : `${p.type === "SUPPLIER" ? "Fournisseur" : "Source sous licence"} · ${p.provider} · ${p.license.reference}`,
    );
    lines.push(`${entity.width} × ${entity.height} px`);
  } else if ("canonicalName" in entity) {
    lines.push(entity.canonicalName);
    lines.push(
      {
        GENERIC: "Visuel générique",
        VARIETY: "Variété identifiée",
        PACKAGED_EXACT: "Conditionnement exact",
      }[entity.specificity],
    );
    for (const v of [entity.variety, entity.appearance, entity.brand])
      if (v) lines.push(v);
    if (!entity.primaryAssetId) lines.push("Aucune image associée");
  } else {
    lines.push(labels[entity.productId] ?? "Produit du magasin");
    lines.push(
      labels[entity.visualIdentityId] ?? "Identité visuelle à consulter",
    );
    lines.push(
      {
        MANUAL_OVERRIDE: "Photo choisie pour ce produit",
        EXACT: "Conditionnement exact",
        INHERITED_GENERIC: "Visuel générique partagé",
      }[entity.linkType],
    );
    lines.push(
      entity.verification === "APPROVED"
        ? "Association confirmée"
        : "Association à examiner",
    );
  }
  if (entity.deletedAt)
    lines.push("Élément supprimé · original conservé pour examen");
  return lines;
}
