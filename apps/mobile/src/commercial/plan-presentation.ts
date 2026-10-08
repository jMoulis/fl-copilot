import type { CommercialWeekPlan } from "@fl-copilot/sync-contracts";
import { commercialMechanismDescription } from "./choice-presentation";
import { formatFrenchCalendarDate } from "../dates/calendar";
export function commercialPlanSummary(p: CommercialWeekPlan) {
  return `Version ${p.version} · ${formatFrenchCalendarDate(p.weekStart)} au ${formatFrenchCalendarDate(p.weekEnd)}\n${p.operations.length} opérations · ${p.offers.length} offres · ${p.preparation.placements.length} TG\n${p.offers.map((o) => `${o.rawProductLabel} → ${p.productRefs.find((r) => r.id === o.productId)?.label ?? "produit indisponible"} : ${commercialMechanismDescription(o.customerMechanism)} (${formatFrenchCalendarDate(o.saleStart)}–${formatFrenchCalendarDate(o.saleEnd)})`).join("\n")}\n${p.preparation.placements.map((t) => `${t.label} : ${t.theme || "sans thème"} (${t.offerIds.map((id) => p.offers.find((o) => o.choiceId === id)?.rawProductLabel ?? "offre indisponible").join(" · ")})`).join("\n")}`;
}
export function commercialPlanError(code: string | undefined) {
  return (
    (
      {
        COMMERCIAL_PLAN_PREPARATION_CHANGED:
          "Le brouillon a changé. Rouvrez la semaine et vérifiez ses offres/TG avant de finaliser.",
        COMMERCIAL_PLAN_CHOICE_CHANGED:
          "Une offre a changé ou a été retirée. Mettez à jour le brouillon et validez sa nouvelle version commerciale.",
        COMMERCIAL_PLAN_CHANGED:
          "Une offre a changé. Mettez à jour sa version dans le brouillon.",
        COMMERCIAL_PLAN_NOT_VALIDATED:
          "Une offre sélectionnée attend sa validation commerciale.",
        COMMERCIAL_PLAN_SOURCE_REFERENCE_REVIEW:
          "Revoyez les offres dont le PDF ne correspond plus à la référence choisie.",
        COMMERCIAL_PLAN_PRODUCT_INVALID:
          "Un produit associé n’est plus actif. Revoyez l’offre concernée.",
        COMMERCIAL_PLAN_PRODUCT_CHANGED:
          "Un produit associé a changé. Rouvrez la vérification du plan.",
        COMMERCIAL_PLAN_DATA_CHANGED:
          "Le contenu ou ses références ont changé. Actualisez la vérification et confirmez à nouveau.",
        COMMERCIAL_PLAN_REFERENCES_CHANGED:
          "Le choix de référence PDF a changé. Relisez la comparaison avant de confirmer le plan.",
        COMMERCIAL_PLAN_REVISION_INVALID:
          "Le plan a changé. Rouvrez-le avant de créer sa nouvelle version.",
        COMMERCIAL_PLAN_RESOLVE_REQUIRED:
          "Comparez les deux plans dans Synchronisation avant de choisir une version.",
        COMMERCIAL_PLAN_EMPTY_TG:
          "Une TG reste vide. Affectez une offre ou retirez cet emplacement du brouillon.",
        COMMERCIAL_PLAN_SYNCING:
          "Le plan s’envoie. Attendez la fin de la synchronisation avant de résoudre ou de remplacer cet envoi.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Le plan ne peut pas encore être validé. Actualisez la vérification et corrigez les points signalés."
  );
}
