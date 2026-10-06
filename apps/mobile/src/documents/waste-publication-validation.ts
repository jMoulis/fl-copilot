import type { Product } from "@fl-copilot/domain";
import { validateWasteReceiptArithmetic } from "@fl-copilot/analytics-core";
import type { LocalWasteReceiptDetail } from "./waste-receipt-repository";
export type WastePublicationField =
  | "date"
  | "source"
  | "duplicate"
  | "processing"
  | "lines"
  | "product"
  | "weight"
  | "quantity"
  | "quantityUnit"
  | "unitPrice"
  | "totalPrice"
  | "save"
  | "rawLabel";
export interface WastePublicationIssue {
  lineId?: string;
  lineIndex?: number;
  label?: string;
  field: WastePublicationField;
  message: string;
}
export interface PublicationProduct {
  nature: Product["nature"];
  sales_unit: Product["salesUnit"];
  status: string;
  deleted_at: string | null;
}
export class WastePublicationValidationError extends Error {
  constructor(readonly issues: WastePublicationIssue[]) {
    super("Certains champs bloquent la publication de la casse.");
    this.name = "WastePublicationValidationError";
  }
}
export function validateWastePublication(
  detail: LocalWasteReceiptDetail,
  products: ReadonlyMap<string, PublicationProduct>,
  sourceConfirmed: boolean,
): WastePublicationIssue[] {
  const { receipt } = detail;
  if (receipt.processingStatus === "PUBLISHED") return [];
  const issues: WastePublicationIssue[] = [];
  if (receipt.processingStatus !== "TO_VALIDATE")
    issues.push({
      field: "processing",
      message: "L’analyse du ticket doit être terminée avant la publication.",
    });
  if (!receipt.confirmedWasteDate)
    issues.push({ field: "date", message: "Confirmez la date de casse." });
  if (!receipt.sourceDocumentId || !sourceConfirmed)
    issues.push({
      field: "source",
      message:
        "L’envoi de la photo source doit être confirmé. Reprenez la synchronisation.",
    });
  if (
    ["POSSIBLE_DUPLICATE", "CONFIRMED_DUPLICATE", "UNCHECKED"].includes(
      receipt.duplicateStatus,
    )
  )
    issues.push({
      field: "duplicate",
      message:
        "Résolvez le doublon avant de publier. Un doublon confirmé ne peut pas être publié.",
    });
  const included = detail.lines.filter(
    ({ line }) => line.validationStatus !== "EXCLUDED",
  );
  if (!included.length)
    issues.push({
      field: "lines",
      message:
        "Aucune ligne incluse dans la casse. Réintégrez une ligne valide ou vérifiez l’extraction.",
    });
  for (const { line } of included) {
    const add = (field: WastePublicationField, message: string) =>
      issues.push({
        lineId: line.id,
        lineIndex: line.sourceLineIndex,
        label: line.rawLabel,
        field,
        message,
      });
    const product = products.get(line.matchedProductId ?? "");
    if (line.matchStatus !== "MATCHED" || !product || product.deleted_at)
      add(
        "product",
        "Associez cette ligne à un produit disponible dans le référentiel.",
      );
    else {
      if (product.status !== "ACTIVE")
        add(
          "product",
          "Ce produit n’est pas actif. Complétez et activez sa fiche produit.",
        );
      if (product.nature === "UNKNOWN")
        add(
          "product",
          "Précisez « Vrac » ou « Conditionné » dans la fiche produit.",
        );
      else if (line.productNature !== product.nature)
        add(
          "product",
          "La nature a changé dans le référentiel. Reconfirmez le produit associé.",
        );
      if (product.sales_unit === "UNKNOWN")
        add(
          "product",
          "Précisez l’unité de vente dans la fiche produit : kg, pièce ou unité conditionnée.",
        );
      else if (product.sales_unit === "KG") {
        if (line.weight == null || Number(line.weight) <= 0)
          add(
            "weight",
            "Saisissez un poids strictement supérieur à zéro en kg pour ce produit.",
          );
      } else {
        if (line.quantityUnit !== product.sales_unit)
          add(
            "quantityUnit",
            `L’unité doit correspondre au produit : ${product.sales_unit === "PIECE" ? "pièces" : "unités conditionnées"}.`,
          );
        if (line.quantity == null || Number(line.quantity) <= 0)
          add(
            "quantity",
            "Saisissez une quantité strictement supérieure à zéro.",
          );
      }
    }
    if (line.totalPrice == null)
      add("totalPrice", "Renseignez le montant de cette ligne en euros.");
    const arithmetic = validateWasteReceiptArithmetic([
      {
        sourceLineIndex: line.sourceLineIndex,
        weight: line.weight ?? null,
        unitPrice: line.unitPrice ?? null,
        totalPrice: line.totalPrice ?? null,
      },
    ]).lines[0]!;
    if (arithmetic.status === "MISMATCH") {
      const message = `Poids × prix unitaire : ${arithmetic.expectedTotal} € attendus, contre ${line.totalPrice} € enregistrés. Vérifiez ces trois champs.`;
      for (const field of ["weight", "unitPrice", "totalPrice"] as const)
        add(field, message);
    }
  }
  return issues;
}
