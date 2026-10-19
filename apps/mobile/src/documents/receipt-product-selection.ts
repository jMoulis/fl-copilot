import { z } from "zod";
import type { ProductListItem } from "../products/product-editor-hooks.types";
import type { WasteReceiptRepository } from "./waste-receipt-repository";

// Read-only origin; never accepts an arbitrary return URL or a caller-supplied label/store.
export const receiptProductOriginSchema = z.strictObject({
  receiptId: z.uuid(),
  lineId: z.uuid(),
});
export type ReceiptProductOrigin = z.infer<typeof receiptProductOriginSchema>;

export async function loadReceiptProductTarget(
  repository: WasteReceiptRepository,
  storeId: string,
  raw: ReceiptProductOrigin,
) {
  const origin = receiptProductOriginSchema.parse(raw);
  const detail = await repository.getReceiptDetail(origin.receiptId, storeId);
  const draft = detail?.lines.find((d) => d.line.id === origin.lineId);
  if (!detail || detail.receipt.deletedAt || !draft || draft.line.deletedAt)
    throw Error("WASTE_RECEIPT_LINE_NOT_FOUND");
  if (detail.receipt.processingStatus === "PUBLISHED")
    throw Error("WASTE_RECEIPT_READ_ONLY");
  return { receipt: detail.receipt, draft };
}

export function canSelectReceiptProduct(item: ProductListItem) {
  const { record, conflictId } = item;
  return (
    !record.entity.deletedAt &&
    record.entity.status !== "INACTIVE" &&
    !conflictId &&
    !["ERROR", "CONFLICT"].includes(record.syncState)
  );
}

export function receiptProductError(error: unknown) {
  switch (error instanceof Error ? error.message : "") {
    case "WASTE_RECEIPT_READ_ONLY":
      return "Ce ticket est publié ou ne peut plus être modifié. Aucune association n’a été changée.";
    case "WASTE_RECEIPT_LINE_CHANGED":
      return "La ligne a changé depuis votre choix. Relisez-la puis choisissez à nouveau le produit.";
    case "WASTE_RECEIPT_PRODUCT_CHANGED":
    case "WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID":
      return "La fiche produit a changé ou n’est plus disponible. Choisissez à nouveau le produit pour vérifier sa version actuelle.";
    case "WASTE_RECEIPT_LINE_NOT_FOUND":
      return "Cette ligne n’est pas disponible dans le magasin actif.";
    default:
      return "La lecture ou l’association n’a pas pu être terminée. Votre choix reste visible ; réessayez.";
  }
}
