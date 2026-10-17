import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotChoiceUpdateInputSchema,
  copilotChoiceUpdatePreviewSchema,
  choiceUpdateRequest,
  choiceUpdateHasChanges,
} from "@fl-copilot/domain";
import { commercialChoiceProductUnitMatches } from "@fl-copilot/commercial-core";
import { readCommercialChoice } from "./commercial-choice-tool.js";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
const operationId = "00000000-0000-4000-8000-000000000001";
export async function previewChoiceUpdate(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotChoiceUpdateInputSchema.parse(raw),
    read = await readCommercialChoice(db, storeId, {
      choiceId: input.choiceId,
    });
  const row = read.choice
    ? await db.collection<ProductDocument>("products").findOne(
        {
          _id: read.choice.productId,
          storeId,
          status: "ACTIVE",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      )
    : null;
  let basis =
    read.choice && row
      ? { before: read.choice, product: serializeProductDocument(row) }
      : null;
  let status:
    "READY" | "UNCHANGED" | "BLOCKED" | "UNAVAILABLE" | "LIMIT_EXCEEDED" = basis
    ? "READY"
    : "UNAVAILABLE";
  if (basis)
    try {
      const request = choiceUpdateRequest(input, basis, operationId);
      if (
        !commercialChoiceProductUnitMatches(
          request.input.draft,
          basis.product.salesUnit,
        )
      ) {
        status = "BLOCKED";
        basis = null;
      } else if (!choiceUpdateHasChanges(input, basis.before))
        status = "UNCHANGED";
    } catch {
      status = "BLOCKED";
      basis = null;
    }
  if (JSON.stringify({ input, basis }).length > 14000) {
    status = "LIMIT_EXCEEDED";
    basis = null;
  }
  const hash = createHash("sha256")
    .update(JSON.stringify([storeId, input, basis, status]))
    .digest("hex");
  return copilotChoiceUpdatePreviewSchema.parse({
    input,
    status,
    basis,
    evidence: [
      {
        id: `choice-update/${hash}`,
        sourceId: read.choice?.source.sourceDocumentId ?? storeId,
        sourceVersion: read.choice?.version ?? null,
        sourceType: "DATA_QUALITY",
        label: "Modification du choix commercial",
        factKind: "QUALITY",
        value:
          status === "READY"
            ? "Modification préparée, à confirmer sur l’appareil. Source et produit conservés ; aucune modification du PDF, des plans validés ou des TG. Les références de brouillons et validations de l’ancienne version devront être réexaminées."
            : status === "UNCHANGED"
              ? "Ces valeurs sont déjà enregistrées ; aucune action."
              : status === "LIMIT_EXCEEDED"
                ? "Aperçu trop volumineux : utilisez l’écran de l’offre, sans tronquer la confirmation."
                : status === "BLOCKED"
                  ? "Modification bloquée : vérifiez les dates, le mécanisme et son unité. Une offre retirée ne sera pas réactivée par cette action."
                  : "Offre ou produit actif indisponible dans les données synchronisées du magasin.",
      },
    ],
  });
}
