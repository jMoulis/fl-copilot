import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotProductPreviewInputSchema,
  copilotProductPreviewResultSchema,
  compareProductClassification,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
const labels = {
  category: "Catégorie",
  nature: "Nature",
  salesUnit: "Unité de vente",
};
const values: Record<string, string> = {
  FRUIT: "Fruit",
  VEGETABLE: "Légume",
  OTHER: "Autre",
  UNKNOWN: "À préciser",
  BULK: "Vrac",
  PACKAGED: "Conditionné",
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
};
/** Read-only preparation. Never creates authority, an operation, or a product write. */
export async function readProductClassificationPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  const input = copilotProductPreviewInputSchema.parse(raw);
  const row = await db.collection<ProductDocument>("products").findOne(
    {
      _id: input.productId,
      storeId,
      deletedAt: null,
      status: { $ne: "INACTIVE" },
    },
    { maxTimeMS: 2000 },
  );
  const before = row ? serializeProductDocument(row) : null;
  if (
    before &&
    (before.id !== input.productId ||
      before.storeId !== storeId ||
      before.deletedAt ||
      before.status === "INACTIVE")
  )
    throw Error("COPILOT_PREVIEW_SCOPE_INVALID");
  const preview = before
    ? compareProductClassification(before, input.patch)
    : null;
  const checksum = createHash("sha256")
    .update(JSON.stringify({ storeId, input, preview }))
    .digest("hex");
  const description = preview
    ? [
        `Produit : ${preview.before.label}. Aperçu uniquement, aucune modification enregistrée.`,
        ...preview.changedFields.map(
          (key) =>
            `${labels[key]} : ${values[preview.before[key]]} → ${values[preview.proposed[key]]}.`,
        ),
        preview.reviewFields.length
          ? "Remplacement d’une information renseignée : examen explicite nécessaire."
          : preview.changedFields.length
            ? "Champs à préciser : confirmation nécessaire avant enregistrement."
            : "Aucune différence avec la fiche actuelle.",
        "L’aperçu concerne la version synchronisée ; les modifications locales non synchronisées sont inconnues.",
      ].join(" ")
    : "Produit indisponible : aucune correction préparée et aucune donnée modifiée.";
  return copilotProductPreviewResultSchema.parse({
    productId: input.productId,
    status: preview ? "PREVIEW" : "UNAVAILABLE",
    preview,
    evidence: [
      {
        id: `product-classification-preview/${checksum}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.productId,
        sourceVersion: before?.version ?? null,
        label: "Aperçu de correction — non enregistré",
        value: description,
        factKind: "QUALITY",
      },
    ],
  });
}
