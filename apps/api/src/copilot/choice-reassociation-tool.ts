import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotChoiceReassociationInputSchema,
  copilotChoiceReassociationPreviewSchema,
  choiceReassociationRequest,
  choiceReassociationHasChanges,
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
export async function previewChoiceReassociation(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotChoiceReassociationInputSchema.parse(raw),
    read = await readCommercialChoice(db, storeId, {
      choiceId: input.choiceId,
    });
  const row = read.choice
    ? await db.collection<ProductDocument>("products").findOne(
        {
          _id: input.productId,
          storeId,
          status: "ACTIVE",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      )
    : null;
  const previous = read.choice
    ? await db
        .collection<ProductDocument>("products")
        .findOne({ _id: read.choice.productId, storeId }, { maxTimeMS: 2000 })
    : null;
  let basis =
    read.choice && row
      ? {
          before: read.choice,
          product: serializeProductDocument(row),
          previousProduct: previous ? serializeProductDocument(previous) : null,
        }
      : null;
  let status:
    "READY" | "UNCHANGED" | "BLOCKED" | "UNAVAILABLE" | "LIMIT_EXCEEDED" = basis
    ? "READY"
    : "UNAVAILABLE";
  if (basis)
    try {
      const request = choiceReassociationRequest(input, basis, operationId);
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
            duplicateKey: createHash("sha256")
              .update(
                commercialChoiceDuplicateKey({
                  ...basis.before,
                  productId: input.productId,
                }),
              )
              .digest("hex"),
          },
          { maxTimeMS: 2000 },
        );
      if (
        duplicate ||
        !commercialChoiceProductUnitMatches(
          request.input.draft,
          basis.product.salesUnit,
        )
      ) {
        status = "BLOCKED";
        basis = null;
      } else if (!choiceReassociationHasChanges(input, basis.before))
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
  return copilotChoiceReassociationPreviewSchema.parse({
    input,
    status,
    basis,
    evidence: [
      {
        id: `choice-reassociation/${hash}`,
        sourceId: read.choice?.source.sourceDocumentId ?? storeId,
        sourceVersion: read.choice?.version ?? null,
        sourceType: "DATA_QUALITY",
        label: "Changement du produit associé",
        factKind: "QUALITY",
        value:
          status === "READY"
            ? "Association préparée, à confirmer sur l’appareil. Source et conditions conservées ; aucune modification du PDF, des plans validés ou des TG. Les références de brouillons et validations de l’ancienne version devront être réexaminées."
            : status === "UNCHANGED"
              ? "Ces valeurs sont déjà enregistrées ; aucune action."
              : status === "LIMIT_EXCEEDED"
                ? "Aperçu trop volumineux : utilisez l’écran de l’offre, sans tronquer la confirmation."
                : status === "BLOCKED"
                  ? "Association bloquée : vérifiez le produit cible, son unité et les éventuels doublons. Une offre retirée ne sera pas réactivée par cette action."
                  : "Offre ou produit actif indisponible dans les données synchronisées du magasin.",
      },
    ],
  });
}
