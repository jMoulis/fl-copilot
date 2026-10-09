import type { NeedMembership } from "@fl-copilot/domain";
export function membershipSummary(m: NeedMembership) {
  return `${{ PROPOSED: "Proposée", VALIDATED: "Validée", REJECTED: "Retirée / rejetée" }[m.status]} · compatibilité déclarée ${Math.round(m.strength * 100)} % · certitude déclarée ${Math.round(m.confidence * 100)} %${m.primary ? " · usage principal" : ""} · ${{ MANUAL: "Déclaration manuelle", AI_PROPOSED: "Origine : proposition IA", LEARNED: "Apprentissage audité" }[m.source]}`;
}
export function membershipError(code?: string) {
  return (
    (
      {
        NEED_MEMBERSHIP_PARENT_INVALID:
          "Vérifiez le produit et le besoin dans le magasin actuel.",
        NEED_MEMBERSHIP_PARENT_INACTIVE:
          "Le produit et le besoin doivent être actifs pour valider cette association.",
        NEED_MEMBERSHIP_HUMAN_DECISION_REQUIRED:
          "Cette validation ou réactivation nécessite votre confirmation explicite.",
        NEED_MEMBERSHIP_RESOLVE_REQUIRED:
          "Comparez les deux versions dans Synchronisation.",
        NEED_MEMBERSHIP_REVISION_INVALID:
          "Cette association a changé. Rechargez-la avant de modifier.",
        NEED_MEMBERSHIP_PARENT_PENDING:
          "Le produit ou le besoin attend sa première synchronisation.",
        NEED_MEMBERSHIP_IDENTITY_CHANGED:
          "Les références de cette association doivent être conservées.",
      } as Record<string, string>
    )[code ?? ""] ??
    "L’association ne peut pas être enregistrée. Les versions locales restent conservées."
  );
}
