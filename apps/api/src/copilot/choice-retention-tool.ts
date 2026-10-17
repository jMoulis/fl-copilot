import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotChoiceRetentionInputSchema,
  copilotChoiceRetentionPreviewSchema,
  choiceRetentionRequest,
} from "@fl-copilot/domain";
import {
  commercialChoiceDuplicateKey,
  commercialChoiceProductUnitMatches,
} from "@fl-copilot/commercial-core";
import { readCommercialChoice } from "./commercial-choice-tool.js";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
const operationId = "00000000-0000-4000-8000-000000000001";
export async function previewChoiceRetention(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotChoiceRetentionInputSchema.parse(raw),
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
  if (basis && basis.before.status === "RETAINED") status = "UNCHANGED";
  else if (basis)
    try {
      const request = choiceRetentionRequest(input, basis, operationId);
      if (
        !commercialChoiceProductUnitMatches(
          request.input.draft,
          basis.product.salesUnit,
        )
      ) {
        status = "BLOCKED";
        basis = null;
      }
    } catch {
      status = "BLOCKED";
      basis = null;
    }
  if (basis && status === "READY") {
    const duplicateKey = createHash("sha256")
      .update(commercialChoiceDuplicateKey(basis.before))
      .digest("hex");
    const duplicate = await db
      .collection<{
        _id: string;
        storeId: string;
        status: string;
        duplicateKey: string;
      }>("commercialOfferChoices")
      .findOne(
        {
          storeId,
          _id: { $ne: basis.before.id },
          status: "RETAINED",
          duplicateKey,
        },
        { maxTimeMS: 2000 },
      );
    if (duplicate) {
      status = "BLOCKED";
      basis = null;
    }
  }
  if (JSON.stringify({ input, basis }).length > 14000) {
    status = "LIMIT_EXCEEDED";
    basis = null;
  }
  const hash = createHash("sha256")
    .update(JSON.stringify([storeId, input, basis, status]))
    .digest("hex");
  return copilotChoiceRetentionPreviewSchema.parse({
    input,
    status,
    basis,
    evidence: [
      {
        id: `choice-retention/${hash}`,
        sourceId: read.choice?.source.sourceDocumentId ?? storeId,
        sourceVersion: read.choice?.version ?? null,
        sourceType: "DATA_QUALITY",
        label: "Retenir à nouveau l’offre",
        factKind: "QUALITY",
        value:
          status === "READY"
            ? "Remise en sélection préparée, à confirmer explicitement sur l’appareil. Produit et conditions conservés ; aucune modification du PDF, des plans validés ou des TG. Les références de brouillons et validations de l’ancienne version devront être réexaminées."
            : status === "UNCHANGED"
              ? "Cette offre est déjà retenue ; aucune nouvelle action."
              : status === "LIMIT_EXCEEDED"
                ? "Aperçu trop volumineux : utilisez l’écran de l’offre, sans tronquer la confirmation."
                : status === "BLOCKED"
                  ? "Remise en sélection bloquée : vérifiez le produit, les dates, la compatibilité de l’unité et les éventuels doublons."
                  : "Offre ou produit actif indisponible dans les données synchronisées du magasin.",
      },
    ],
  });
}
