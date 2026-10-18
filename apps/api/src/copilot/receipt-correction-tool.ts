import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  receiptCorrectionInputSchema,
  receiptCorrectionPreviewSchema,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
import type { WasteReceiptDraftReader } from "../uploads/waste-receipt-draft.js";
import { previewReceiptPublication } from "./receipt-publication-tool.js";
/** A native before/after review owns local unpublished corrections, never the remote extraction. */
export async function previewReceiptCorrection(
  db: Db,
  storeId: string,
  raw: unknown,
  reader: WasteReceiptDraftReader,
  schemaVersion: 1 | 2 = 1,
) {
  const input = receiptCorrectionInputSchema.parse(raw),
    base = await previewReceiptPublication(
      db,
      storeId,
      { sourceDocumentId: input.sourceDocumentId },
      reader,
    );
  const status =
    base.status === "ALREADY_PUBLISHED" ? "READ_ONLY" : base.status;
  if (schemaVersion === 2 && status === "REVIEW_LOCAL") {
    const ids = [
      ...new Set(
        (input.patch.lines ?? []).flatMap((line) =>
          line.productId ? [line.productId] : [],
        ),
      ),
    ];
    if (ids.length) {
      const rows = await db
        .collection<ProductDocument>("products")
        .find({
          _id: { $in: ids },
          storeId,
          status: { $ne: "INACTIVE" },
          deletedAt: null,
        })
        .limit(11)
        .maxTimeMS(2000)
        .toArray();
      const products = rows.map(serializeProductDocument);
      if (
        products.length !== ids.length ||
        new Set(products.map((p) => p.id)).size !== ids.length ||
        products.some(
          (p) =>
            !ids.includes(p.id) ||
            p.storeId !== storeId ||
            p.deletedAt ||
            p.status === "INACTIVE",
        )
      )
        throw Error("RECEIPT_CORRECTION_PRODUCT_UNAVAILABLE");
    }
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input,
        base.source,
        status,
        ...(schemaVersion === 2 ? [2] : []),
      ]),
    )
    .digest("hex");
  return receiptCorrectionPreviewSchema.parse({
    ...(schemaVersion === 2 ? { schemaVersion: 2 } : {}),
    input,
    source: base.source,
    status,
    evidence: [
      {
        id: `receipt-correction/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.sourceDocumentId,
        sourceVersion: base.evidence[0]?.sourceVersion ?? null,
        label: "Correction du brouillon de casse",
        value:
          status === "REVIEW_LOCAL"
            ? "Correction proposée, non enregistrée. L’appareil comparera uniquement les champs demandés au brouillon actuel avant confirmation explicite. Aucune publication, aucun apprentissage d’alias et aucune modification de chiffre publié."
            : status === "READ_ONLY"
              ? "Ce ticket est déjà publié et ne peut pas être réécrit."
              : "Brouillon indisponible ou revue trop volumineuse ; aucune correction préparée.",
        factKind: "QUALITY",
      },
    ],
  });
}
