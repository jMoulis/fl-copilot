import type { NeedUnit } from "@fl-copilot/domain";
export function needUnitSummary(n: NeedUnit) {
  return `${n.name} · ${n.code} · ${{ ACTIVE: "Active", TO_REVIEW: "À revoir", INACTIVE: "Désactivée" }[n.status]}${n.description ? ` · ${n.description}` : ""}`;
}
export function needUnitError(code?: string) {
  return (
    (
      {
        NEED_UNIT_CODE_IN_USE:
          "Ce code est déjà utilisé. Choisissez-en un autre pour cette création non synchronisée.",
        NEED_UNIT_CODE_IMMUTABLE:
          "Le code d’une unité synchronisée doit être conservé.",
        NEED_UNIT_IDENTITY_CHANGED:
          "Le code et l’origine d’une unité synchronisée doivent être conservés.",
        NEED_UNIT_RESOLVE_REQUIRED:
          "Comparez les deux versions dans Synchronisation.",
        NEED_UNIT_REVISION_INVALID:
          "L’unité a changé. Rouvrez sa fiche avant de modifier.",
        NEED_UNIT_SYNCING:
          "Un envoi est en cours. Réessayez après la synchronisation.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Cette modification n’a pas pu être enregistrée. Votre version locale reste conservée."
  );
}
