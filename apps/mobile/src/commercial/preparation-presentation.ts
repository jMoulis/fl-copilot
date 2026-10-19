import type { CommercialWeekPreparation } from "@fl-copilot/sync-contracts";
import { formatFrenchCalendarDate } from "@/dates/calendar";
export function physicalAllocationSummary(p: CommercialWeekPreparation) {
  const s = p.physicalAllocation;
  return s
    ? `Implantation : ${s.title} · plan source v${s.physicalVersion}\n${s.assignments.map((a) => `${a.targetLabel} : ${a.items.map((r) => s.items.find((i) => i.id === r.id && i.kind === r.kind)!.label).join(" · ")}`).join("\n")}`
    : "Implantation : aucune répartition liée.";
}
export function commercialPreparationSummary(p: CommercialWeekPreparation) {
  return `Brouillon du ${formatFrenchCalendarDate(p.weekStart)} au ${formatFrenchCalendarDate(p.weekEnd)}\n${p.offerRefs.length} offres sélectionnées · ${p.placements.length} TG préparées / ${p.tgCapacity ?? "capacité à préciser"}\n${p.placements.map((tg) => `${tg.label} : ${tg.theme || "thème à préciser"} (${tg.offerIds.length} offres)`).join("\n")}\n${physicalAllocationSummary(p)}`;
}
export function commercialPreparationError(code: string | undefined) {
  return (
    (
      {
        PHYSICAL_ALLOCATION_CLIENT_REQUIRED:
          "Mettez l’application à jour pour modifier cette préparation et son implantation.",
        PHYSICAL_ALLOCATION_FORBIDDEN:
          "Seul un responsable peut enregistrer l’implantation dans la préparation.",
        PHYSICAL_ALLOCATION_EXPLICIT_REMOVAL_REQUIRED:
          "Retirez explicitement l’implantation dans la préparation avant d’enregistrer son retrait.",
        PHYSICAL_ALLOCATION_SOURCES_CHANGED:
          "Le plan ou une référence produit/offre a changé ou manque sur cet appareil. Synchronisez et demandez une proposition actualisée.",
        PHYSICAL_ALLOCATION_GEOMETRY_BLOCKED:
          "Le plan source présente une incompatibilité connue. Corrigez-la dans Plan et mobilier avant d’enregistrer cette implantation.",
        PHYSICAL_ALLOCATION_OFFER_REFRESH_REQUIRED:
          "Une offre du brouillon utilise une ancienne version. Actualisez cette référence avant de lier l’implantation ; elle ne sera pas remplacée automatiquement.",
        PHYSICAL_ALLOCATION_SYNC_CONFLICT:
          "Une source ou le brouillon est en erreur ou en conflit. Résolvez son état dans Synchronisation avant d’enregistrer.",
        PHYSICAL_ALLOCATION_PREPARATION_CHANGED:
          "Le brouillon a changé depuis votre comparaison. Actualisez-la pour examiner la nouvelle version avant de confirmer.",
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
