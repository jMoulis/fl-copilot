export function commercialVersionDecisionError(code: string | undefined) {
  return (
    (
      {
        COMMERCIAL_VERSION_DECISION_RESOLVE_REQUIRED:
          "Deux appareils ont fait des choix différents. Comparez-les dans Synchronisation.",
        COMMERCIAL_VERSION_DECISION_REVISION_INVALID:
          "La décision a changé. Rouvrez la comparaison avant de modifier votre choix.",
        COMMERCIAL_VERSION_DECISION_SOURCE_INVALID:
          "Les deux lectures doivent être complètes et correspondre aux originaux comparés. Synchronisez puis recommencez la comparaison.",
        COMMERCIAL_VERSION_DECISION_SYNCING:
          "Le choix se synchronise. Réessayez après son envoi.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Le choix de référence n’a pas pu être enregistré. Rouvrez la comparaison et vérifiez les deux documents."
  );
}
