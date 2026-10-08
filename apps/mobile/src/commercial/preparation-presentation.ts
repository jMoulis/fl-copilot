import type { CommercialWeekPreparation } from "@fl-copilot/sync-contracts";
import { formatFrenchCalendarDate } from "@/dates/calendar";
export function commercialPreparationSummary(p: CommercialWeekPreparation) {
  return `Brouillon du ${formatFrenchCalendarDate(p.weekStart)} au ${formatFrenchCalendarDate(p.weekEnd)}\n${p.offerRefs.length} offres sélectionnées · ${p.placements.length} TG préparées / ${p.tgCapacity ?? "capacité à préciser"}\n${p.placements.map((tg) => `${tg.label} : ${tg.theme || "thème à préciser"} (${tg.offerIds.length} offres)`).join("\n")}`;
}
export function commercialPreparationError(code: string | undefined) {
  return (
    (
      {
        COMMERCIAL_PREPARATION_OFFERS_CHANGED:
          "Une offre a été modifiée, retirée, ou doit être resynchronisée. Relisez les affectations puis mettez à jour les offres du brouillon.",
        COMMERCIAL_PREPARATION_RESOLVE_REQUIRED:
          "Comparez les deux préparations dans Synchronisation avant de modifier le brouillon.",
        COMMERCIAL_PREPARATION_REVISION_INVALID:
          "Le brouillon a changé. Rouvrez-le avant de le modifier.",
        COMMERCIAL_PREPARATION_SOURCE_INVALID:
          "L’idée de TG n’est plus disponible dans la copie source. Retirez ce lien ou consultez le document.",
        COMMERCIAL_PREPARATION_SYNCING:
          "La préparation se synchronise. Réessayez après la fin de l’envoi.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Le brouillon n’a pas pu être enregistré. Vérifiez les emplacements et les offres sélectionnées."
  );
}
