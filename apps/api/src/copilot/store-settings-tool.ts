import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  storeMerchandisingSummary,
  copilotStoreSettingsInputSchema,
  copilotStoreSettingsResultSchema,
  copilotVisibleStoreSettingsSchema,
} from "@fl-copilot/domain";
import {
  serializeStoreContext,
  type StoreContextDocument,
} from "../store-context-sync.js";

/** Read the synchronized configuration, never the phone's current location. */
export async function readCopilotStoreSettings(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  copilotStoreSettingsInputSchema.parse(raw);
  const row = await db
    .collection<StoreContextDocument>("storeContextSettings")
    .findOne({ storeId }, { maxTimeMS: 2000 });
  let settings: z.infer<typeof copilotVisibleStoreSettingsSchema> | null = null;
  if (row) {
    const entity = serializeStoreContext(row);
    if (
      entity.storeId !== storeId ||
      entity.id !== storeId ||
      row._id !== entity.id
    )
      throw Error("COPILOT_STORE_SETTINGS_SCOPE_INVALID");
    const { position, ...visible } = entity;
    void position;
    settings = copilotVisibleStoreSettingsSchema.parse(visible);
  }
  const revision = createHash("sha256")
    .update(JSON.stringify([storeId, settings]))
    .digest("hex");
  return copilotStoreSettingsResultSchema.parse({
    settings,
    evidence: [
      {
        id: `store-settings/${revision}`,
        sourceType: "DATA_QUALITY",
        sourceId: storeId,
        sourceVersion: settings?.version ?? null,
        label: "Réglages synchronisés du magasin",
        value: settings
          ? `Commune : ${settings.city} ; code postal ${settings.postalCode} ; pays France ; fuseau ${settings.timezone}. Zone scolaire : ${settings.schoolZone ?? "non précisée"}. Localisation configurée ${settings.locationMode === "CITY" ? "par commune" : "par un point enregistré, dont les coordonnées sont masquées"}. Révision ${settings.version}, mise à jour ${settings.updatedAt}. ${storeMerchandisingSummary(settings.merchandising)} Il s'agit des réglages synchronisés du magasin, pas de la position actuelle du téléphone, d'une preuve d'adresse ou d'horaires d'ouverture. D'éventuelles modifications locales non synchronisées sont inconnues. Consulter store_week pour les sources météo/calendrier ; la configuration seule ne prouve ni météo, ni fréquentation, ni résultat commercial.`
          : "Aucun réglage synchronisé disponible pour ce magasin. Une configuration locale non synchronisée peut exister. Demander la commune, le code postal ou la zone scolaire seulement si nécessaire à la question ; ne pas inventer la localisation. Les chiffres déjà disponibles restent utilisables.",
        factKind: "QUALITY",
      },
    ],
  });
}
