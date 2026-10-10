import {
  storeEventLabels,
  storeEventTimeLabel,
  type StoreProductEvent,
} from "@fl-copilot/domain";
export function storeEventSummary(e: StoreProductEvent) {
  return `${storeEventLabels[e.type]} · ${e.status === "CLOSED" ? "Terminé" : e.status === "TO_REVIEW" ? "À examiner" : "En cours"} · début ${storeEventTimeLabel(e.startedAt)}${e.endedAt ? ` · fin ${storeEventTimeLabel(e.endedAt)}` : ""} · gravité ${e.severity === null ? "non précisée" : { LOW: "faible", MEDIUM: "moyenne", HIGH: "élevée" }[e.severity]} · ${e.source === "USER" ? "Observation magasin" : "Source documentaire"}${e.comment ? ` · ${e.comment}` : ""}`;
}
export function storeEventError(code?: string) {
  return (
    (
      {
        STORE_EVENT_PRODUCT_INVALID:
          "Ce produit doit être présent dans le magasin actuel. Ses informations de catégorie ou d’unité peuvent rester incomplètes.",
        STORE_EVENT_PARENT_PENDING:
          "Le produit ou le signalement attend sa première synchronisation. Votre observation reste conservée sur cet appareil.",
        STORE_EVENT_END_INVALID:
          "La fin doit se situer après le début et ne pas être dans le futur.",
        STORE_EVENT_CREATE_PENDING:
          "Synchronisez d’abord la création de cet événement avant de le clôturer.",
        STORE_EVENT_ALREADY_CLOSED:
          "Ce signalement est déjà terminé. Son heure de fin reste conservée.",
        STORE_EVENT_RESOLVE_REQUIRED:
          "Comparez les heures dans Synchronisation avant de clôturer.",
        STORE_EVENT_IMMUTABLE_CAPTURE:
          "Le produit, le type et la capture initiale diffèrent. Vous pouvez adopter la version distante, sans réécrire l’observation initiale.",
        STORE_EVENT_IDENTITY_CHANGED:
          "Un signalement déjà enregistré garde sa capture initiale. Revenez à la fiche produit pour le consulter.",
        STORE_EVENT_SOURCE_INVALID:
          "Une instruction commerciale ne doit pas être clôturée comme un incident magasin.",
        STORE_EVENT_SYNCING: "L’envoi est en cours. Réessayez après sa fin.",
        STORE_EVENT_MISSING:
          "Ce signalement n’existe pas dans le magasin actuel.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Le signalement ne peut pas être enregistré. Les données locales restent conservées."
  );
}

export function storeEventSyncState(s: string) {
  return (
    (
      {
        SYNCED: "Synchronisé",
        PENDING: "À synchroniser",
        CONFLICT: "Conflit à comparer",
        ERROR: "Envoi à reprendre",
      } as Record<string, string>
    )[s] ?? "À synchroniser"
  );
}
