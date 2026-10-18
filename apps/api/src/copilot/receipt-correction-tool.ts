import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  receiptCorrectionInputSchema,
  receiptCorrectionPreviewSchema,
} from "@fl-copilot/domain";
import type { WasteReceiptDraftReader } from "../uploads/waste-receipt-draft.js";
import { previewReceiptPublication } from "./receipt-publication-tool.js";
/** A native before/after review owns local unpublished corrections, never the remote extraction. */
export async function previewReceiptCorrection(
  db: Db,
  storeId: string,
  raw: unknown,
  reader: WasteReceiptDraftReader,
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
  const digest = createHash("sha256")
    .update(JSON.stringify([input, base.source, status]))
    .digest("hex");
  return receiptCorrectionPreviewSchema.parse({
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
