import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotChoiceReadInputSchema,
  copilotChoiceReadResultSchema,
} from "@fl-copilot/domain";
import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync.js";
/** Read one owned current retained/withdrawn choice. Never reviews its source or writes. */
export async function readCommercialChoice(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = copilotChoiceReadInputSchema.parse(raw);
  const row = await db
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .findOne({ _id: input.choiceId, storeId }, { maxTimeMS: 2000 });
  const choice = row ? serializeCommercialChoice(row) : null;
  if (
    choice &&
    (row!._id !== choice.id ||
      choice.id !== input.choiceId ||
      choice.storeId !== storeId)
  )
    throw Error("COPILOT_CHOICE_SCOPE_INVALID");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([storeId, input, choice]))
    .digest("hex");
  return copilotChoiceReadResultSchema.parse({
    ...input,
    choice,
    evidence: [
      {
        id: `commercial-choice-inspection/${fingerprint}`,
        sourceId: choice?.source.sourceDocumentId ?? storeId,
        sourceVersion: choice?.version ?? null,
        sourceType: choice ? "COMMERCIAL_OPERATION" : "DATA_QUALITY",
        label: choice
          ? `Choix ${choice.status === "RETAINED" ? "retenu" : "retiré"} — ${choice.rawProductLabel}`
          : "Choix commercial indisponible",
        factKind: choice?.status === "RETAINED" ? "PLANNED" : "QUALITY",
        value: choice
          ? `${choice.operationKind} — ${choice.operationLabel} ; du ${choice.saleStart} au ${choice.saleEnd} ; ${commercialMechanismDescription(choice.mechanism)}. État actuel : ${choice.status === "RETAINED" ? "retenu" : "retiré"}, révision ${choice.version}. Cette lecture ne prouve ni une validation commerciale actuelle, ni une présence dans un plan, ni une mise en rayon.`
          : "Ce choix n’est pas disponible dans les données synchronisées de ce magasin. Cela ne prouve ni son absence sur un appareil, ni l’absence d’une instruction PDF. Aucun changement.",
      },
    ],
  });
}
