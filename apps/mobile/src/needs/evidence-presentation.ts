import type { SubstitutionEvidence } from "@fl-copilot/domain";
export const evidenceStatusLabel = (status: SubstitutionEvidence["status"]) =>
  ({
    READY: "Comparaison disponible",
    WAITING_EVENT_END: "Fin du signalement attendue",
    WAITING_DAILY_CLOSE: "Journée de vente à terminer",
    MISSING_SALES: "Ventes quotidiennes manquantes",
    INVALID_REFERENCE: "Référence insuffisante",
    DUPLICATE_EVENT_REVIEW: "Signalements similaires à examiner",
    INELIGIBLE: "Relation ou produit indisponible",
    WINDOW_TOO_LONG: "Période trop longue pour cette comparaison",
  })[status];
export const evidenceReasonLabel = (code: string) =>
  (
    ({
      DAILY_NOT_HOURLY:
        "Ventes par jour : aucune réponse horaire n’est estimée.",
      SOURCE_SALES_VALUE_NOT_QUANTITY:
        "Comparaison en euros des valeurs de vente Mercalys, pas des quantités.",
      NEED_NOT_OBSERVED_IN_SALES:
        "Le besoin client n’est pas observé directement dans les ventes.",
      WEATHER_NOT_OBSERVED:
        "La météo observée n’est pas disponible ; une prévision ne la remplace pas.",
      MARKET_CONTEXT_UNKNOWN:
        "Le contexte de tension du marché reste incomplet.",
      PARTIAL_EVENT_WHOLE_DAY_CONTEXT:
        "Le signalement couvre une partie de journée ; les ventes portent sur la journée entière.",
      PROBABLE_DUPLICATE_EVENT:
        "Des signalements du même type et du même produit se chevauchent. Aucun double indice exploitable n’est produit.",
      CONCURRENT_STORE_EVENTS:
        "D’autres incidents peuvent expliquer l’évolution.",
      PRICE_CONTEXT_CHANGED:
        "Une hausse de prix déclarée peut modifier les ventes en euros.",
      CANDIDATE_UNAVAILABLE_OR_QUALITY:
        "Le remplaçant a lui-même un problème de disponibilité ou de qualité.",
      COMMERCIAL_CONTEXT_PLANNED_OR_DECLARED:
        "Une opération commerciale est planifiée ou une tâche est déclarée faite ; son exécution complète n’est pas déduite.",
      PROMOTIONS_NOT_EXHAUSTIVELY_KNOWN:
        "L’absence de promotion enregistrée ne prouve pas l’absence de promotion.",
      SINGLE_REFERENCE_WEEKDAY:
        "Un seul jour de référence est disponible : comparaison fragile.",
      CANDIDATE_DAILY_SALES_MISSING_OR_PARTIAL:
        "Il manque une vente quotidienne complète du remplaçant. Une absence n’est pas zéro.",
      COMPARABLE_REFERENCE_MISSING:
        "Aucun même jour de semaine antérieur comparable n’est disponible sur les quatre semaines cherchées.",
      REFERENCE_ZERO_OR_NEGATIVE:
        "La référence est nulle ou négative : aucun pourcentage de variation fiable.",
      SOURCE_SALES_MISSING_NOT_ZERO:
        "Les ventes du produit initial sont absentes ; elles ne sont pas assimilées à zéro.",
      PUBLIC_HOLIDAY_CONTEXT: "Un jour férié touche la comparaison.",
      SCHOOL_HOLIDAY_CONTEXT: "Des vacances scolaires touchent la comparaison.",
      PUBLIC_HOLIDAY_CONTEXT_INCOMPLETE:
        "Le calendrier des jours fériés n’est pas entièrement disponible.",
      SCHOOL_HOLIDAY_CONTEXT_INCOMPLETE:
        "Le calendrier scolaire n’est pas entièrement disponible.",
      NEGATIVE_VARIATION_INSUFFICIENT_CAUSAL_CONTEXT:
        "Une baisse ne suffit pas à contredire une substitution avec ce contexte incomplet.",
      RELATION_STILL_PROPOSED:
        "La relation est encore proposée, sans validation implicite.",
      PARENT_OR_RELATION_INELIGIBLE:
        "Le produit, le besoin ou la relation n’est plus utilisable pour cet indice.",
      ZERO_OR_INVALID_EVENT_INTERVAL:
        "Un intervalle nul ne permet pas de comparer une période d’incident.",
    }) as Record<string, string>
  )[code] ?? "Un point de qualité de données demande une vérification.";
export function evidenceMoney(value: string | null) {
  return value === null
    ? "Indisponible"
    : Number(value).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
      });
}
export function evidenceVariation(value: string | null) {
  return value === null
    ? "Non calculée"
    : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function evidenceDay(day: string) {
  return day.split("-").reverse().join("/");
}
