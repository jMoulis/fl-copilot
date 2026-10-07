import { resolveWasteReceiptQuantity, type Product } from "@fl-copilot/domain";
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
  | "rawLabel"
  | "cashierNumber";
export interface WastePublicationIssue {
  lineId?: string;
  lineIndex?: number;
  label?: string;
  field: WastePublicationField;
  message: string;
}
export interface WastePublicationWarning extends WastePublicationIssue {
  productId?: string;
  kind: "CATALOG" | "QUANTITY";
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
    if (line.weight != null && Number(line.weight) <= 0)
      add(
        "weight",
        "Le poids saisi doit être strictement supérieur à zéro, ou laissé vide s’il est inconnu.",
      );
    if (line.quantity != null && Number(line.quantity) <= 0)
      add(
        "quantity",
        "La quantité saisie doit être strictement supérieure à zéro, ou laissée vide si elle est inconnue.",
      );
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

export function wastePublicationWarnings(
  detail: LocalWasteReceiptDetail,
  products: ReadonlyMap<string, PublicationProduct>,
): WastePublicationWarning[] {
  const warnings: WastePublicationWarning[] = [];
  for (const { line } of detail.lines) {
    if (line.validationStatus === "EXCLUDED") continue;
    const product = products.get(line.matchedProductId ?? "");
    if (!product || product.deleted_at || line.matchStatus !== "MATCHED")
      continue;
    const add = (kind: WastePublicationWarning["kind"], message: string) =>
      warnings.push({
        kind,
        productId: line.matchedProductId ?? undefined,
        lineId: line.id,
        lineIndex: line.sourceLineIndex,
        label: line.rawLabel,
        field: "product",
        message,
      });
    if (product.status !== "ACTIVE")
      add(
        "CATALOG",
        "Le produit est identifié mais sa fiche n’est pas active. Sa casse peut être enregistrée ; le référentiel est à revoir séparément.",
      );
    if (product.nature === "UNKNOWN")
      add(
        "CATALOG",
        "Nature à préciser dans le référentiel : la valeur est comptée, mais la répartition vrac/conditionné restera incomplète.",
      );
    if (product.sales_unit === "UNKNOWN")
      add(
        "CATALOG",
        "Unité de vente à préciser dans le référentiel : la valeur est comptée, mais la quantité analytique restera indisponible.",
      );
    else if (resolveWasteReceiptQuantity(line, product.sales_unit) === null)
      add(
        "QUANTITY",
        "Quantité absente ou unité non comparable : le montant peut être enregistré. Cette ligne ne contribuera pas au total des quantités.",
      );
  }
  return warnings;
}
