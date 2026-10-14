import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotProductBatchPreviewInputSchema,
  copilotProductBatchPreviewResultSchema,
  type Product,
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
  return buildProductClassificationPreview(storeId, input, before);
}

function buildProductClassificationPreview(
  storeId: string,
  input: z.infer<typeof copilotProductPreviewInputSchema>,
  before: Product | null,
) {
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
  const description =
    before && before.version < 1
      ? "La version de cette fiche ne permet pas encore une correction par lot. Actualisez le référentiel ; aucune correction n’a été enregistrée."
      : preview
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
        sourceVersion: before && before.version > 0 ? before.version : null,
        label: "Aperçu de correction — non enregistré",
        value: description,
        factKind: "QUALITY",
      },
    ],
  });
}

export async function readProductClassificationBatchPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  const input = copilotProductBatchPreviewInputSchema.parse(raw);
  const rows = await db
    .collection<ProductDocument>("products")
    .find({
      _id: { $in: input.changes.map((item) => item.productId) },
      storeId,
      deletedAt: null,
      status: { $ne: "INACTIVE" },
    })
    .maxTimeMS(2000)
    .limit(10)
    .toArray();
  const owned = new Map(
    rows.map((row) => {
      const product = serializeProductDocument(row);
      if (
        product.storeId !== storeId ||
        !input.changes.some((item) => item.productId === product.id)
      )
        throw Error("COPILOT_PREVIEW_SCOPE_INVALID");
      return [product.id, product];
    }),
  );
  const items = input.changes.map((item) =>
    buildProductClassificationPreview(
      storeId,
      item,
      owned.get(item.productId) ?? null,
    ),
  );
  return copilotProductBatchPreviewResultSchema.parse({
    status: items.every(
      (item) => item.status === "PREVIEW" && item.preview!.before.version > 0,
    )
      ? "COMPLETE"
      : "BLOCKED",
    items,
    evidence: items.flatMap((item) => item.evidence),
  });
}
