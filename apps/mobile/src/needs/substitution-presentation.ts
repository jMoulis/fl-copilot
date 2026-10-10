import type { ProductSubstitution } from "@fl-copilot/domain";
export function substitutionSummary(
  e: ProductSubstitution,
  names?: { products: Record<string, string>; needs: Record<string, string> },
) {
  return `${names?.products[e.sourceProductId] ?? "Produit source conservé"} → ${names?.products[e.substituteProductId] ?? "Remplaçant conservé"} · besoin ${names?.needs[e.needUnitId] ?? "Besoin conservé"} · ${{ PROPOSED: "Proposée", VALIDATED: "Validée", LEARNING: "En apprentissage", REJECTED: "Rejetée" }[e.status]} · besoin ${Math.round(e.needCompatibility * 100)} % · usage ${Math.round(e.usageCompatibility * 100)} % · prix ${e.priceCompatibility === null ? "indisponible" : Math.round(e.priceCompatibility * 100) + " %"} · conditionnement ${e.packagingCompatibility === null ? "indisponible" : Math.round(e.packagingCompatibility * 100) + " %"} · ${e.evidenceCount} observation(s) · score ${e.relationshipScore === null ? "non calculé" : Math.round(e.relationshipScore * 100) + " %"} · confiance apprise ${e.confidence === null ? "indisponible" : Math.round(e.confidence * 100) + " %"}`;
}
export function substitutionError(code?: string) {
  const messages: Record<string, string> = {
    PRODUCT_SUBSTITUTION_LEARNING_READ_ONLY:
      "Les scores appris sont conservés : seules vos déclarations sont modifiables.",
    PRODUCT_SUBSTITUTION_PARENT_INVALID:
      "Les deux produits et le besoin doivent appartenir au magasin actuel.",
    PRODUCT_SUBSTITUTION_PARENT_INACTIVE:
      "Activez les deux produits et le besoin client avant de valider la relation.",
    PRODUCT_SUBSTITUTION_HUMAN_DECISION_REQUIRED:
      "Cette validation ou réactivation nécessite votre confirmation explicite.",
    PRODUCT_SUBSTITUTION_RESOLVE_REQUIRED:
      "Comparez les deux versions dans Synchronisation avant de modifier la relation.",
    PRODUCT_SUBSTITUTION_REVISION_INVALID:
      "La relation a changé. Rechargez-la avant de confirmer votre modification.",
    PRODUCT_SUBSTITUTION_IDENTITY_CHANGED:
      "Les produits, le besoin et l’origine de cette relation doivent être conservés.",
    PRODUCT_SUBSTITUTION_PARENT_PENDING:
      "Un produit ou le besoin attend sa première synchronisation. La relation reste conservée sur cet appareil.",
    PRODUCT_SUBSTITUTION_SYNCING:
      "L’envoi de cette relation est en cours. Réessayez après sa fin.",
  };
  return (
    messages[code ?? ""] ??
    "La relation ne peut pas être enregistrée. Votre version locale reste conservée."
  );
}
