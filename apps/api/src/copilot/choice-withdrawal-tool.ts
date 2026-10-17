import type { Db } from "mongodb";
import {
  copilotChoiceWithdrawalInputSchema,
  copilotChoiceWithdrawalPreviewSchema,
} from "@fl-copilot/domain";
import { readCommercialChoice } from "./commercial-choice-tool.js";
/** Preparation only: the native explicit decision owns the canonical write. */
export async function previewChoiceWithdrawal(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotChoiceWithdrawalInputSchema.parse(raw),
    read = await readCommercialChoice(db, storeId, input);
  const oversized = JSON.stringify(read.choice).length > 14000;
  const status = oversized
    ? "LIMIT_EXCEEDED"
    : !read.choice
      ? "UNAVAILABLE"
      : read.choice.status === "WITHDRAWN"
        ? "UNCHANGED"
        : "READY";
  return copilotChoiceWithdrawalPreviewSchema.parse({
    input,
    status,
    before: oversized ? null : read.choice,
    evidence: read.evidence.map((e) => ({
      ...e,
      id: `withdrawal/${e.id}`,
      label: "Retrait du choix commercial",
      factKind: "QUALITY",
      value:
        status === "LIMIT_EXCEEDED"
          ? "Cette offre est trop volumineuse pour une confirmation complète. Ouvrez son écran pour examiner le retrait ; aucune donnée tronquée ni action enregistrée."
          : status === "READY"
            ? `Retrait préparé pour ${read.choice!.rawProductLabel}, à confirmer sur l’appareil. Les documents, plans validés et anciennes mises en place sont conservés. Les brouillons référençant cette offre devront être examinés ; aucune TG ni affectation n’est supprimée automatiquement.`
            : status === "UNCHANGED"
              ? "Ce choix est déjà retiré ; aucune nouvelle action."
              : "Choix indisponible dans les données synchronisées de ce magasin ; aucun retrait préparé.",
    })),
  });
}
