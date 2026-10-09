import type { StoreContextSettings } from "@fl-copilot/sync-contracts";
export function storeContextSummary(s: StoreContextSettings) {
  return `${s.city} · ${s.postalCode}\nVacances : ${s.schoolZone ? `zone ${s.schoolZone}` : "zone non précisée"}\n${s.locationMode === "CITY" ? "Localisation par commune" : `Position du magasin : ${s.position?.latitude}, ${s.position?.longitude}`}`;
}
export function storeContextError(code: string | undefined) {
  return (
    (
      {
        STORE_CONTEXT_RESOLVE_REQUIRED:
          "Les réglages sont en conflit. Comparez les deux configurations dans Synchronisation.",
        STORE_CONTEXT_REVISION_INVALID:
          "Les réglages ont changé. Rouvrez la page Magasin avant d’enregistrer.",
        STORE_CONTEXT_SYNCING:
          "Les réglages s’envoient. Attendez la fin de la synchronisation.",
      } as Record<string, string>
    )[code ?? ""] ??
    "Les réglages n’ont pas pu être enregistrés. Vérifiez les champs ou rouvrez la page Magasin."
  );
}
