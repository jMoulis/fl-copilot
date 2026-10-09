import type { ProductSubstitution } from "@fl-copilot/domain";
export function substitutionSummary(e: ProductSubstitution) {
  return `${e.sourceProductId} → ${e.substituteProductId} · besoin ${e.needUnitId} · ${{ PROPOSED: "Proposée", VALIDATED: "Validée", LEARNING: "En apprentissage", REJECTED: "Rejetée" }[e.status]} · besoin ${Math.round(e.needCompatibility * 100)} % · usage ${Math.round(e.usageCompatibility * 100)} % · prix ${e.priceCompatibility === null ? "indisponible" : Math.round(e.priceCompatibility * 100) + " %"} · conditionnement ${e.packagingCompatibility === null ? "indisponible" : Math.round(e.packagingCompatibility * 100) + " %"} · ${e.evidenceCount} observation(s) · score ${e.relationshipScore === null ? "non calculé" : e.relationshipScore}`;
}
export function substitutionError(code?: string) {
  return code === "PRODUCT_SUBSTITUTION_LEARNING_READ_ONLY"
    ? "Les scores appris sont conservés : seules vos déclarations sont modifiables."
    : "La relation ne peut pas être enregistrée. Rechargez-la ou comparez les versions dans Synchronisation.";
}
