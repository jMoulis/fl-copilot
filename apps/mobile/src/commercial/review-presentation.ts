import type { CommercialMechanism } from "@fl-copilot/domain";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
export const commercialFieldLabels: Record<string, string> = {
  operationName: "Opération",
  operationNature: "Nature de l’opération",
  theme: "Thème",
  productLabel: "Produit indiqué",
  productIdentifier: "Identifiant source",
  sellingPrice: "Prix de vente",
  priceOperator: "Condition du prix",
  salesUnit: "Unité de vente",
  customerMechanism: "Avantage client",
  purchasePrice: "Prix d’achat",
  supplierCondition: "Condition fournisseur",
  documentDate: "Date du document",
  saleStart: "Début des ventes",
  saleEnd: "Fin des ventes",
  preorderStart: "Début de précommande",
  preorderDeadline: "Fin de précommande",
  deliveryStart: "Début de livraison",
  deliveryEnd: "Fin de livraison",
  executionDeadline: "Échéance",
  communicationStart: "Début de communication",
  communicationEnd: "Fin de communication",
  instruction: "Consigne",
  channel: "Canal",
  tg: "Tête de gondole",
  marketSignal: "Signal marché",
  applicabilityCondition: "Condition d’application",
  weekLabel: "Semaine",
};
export const commercialKindLabels: Record<string, string> = {
  OPERATION: "Opération",
  OFFER: "Offre proposée",
  EXECUTION_INSTRUCTION: "Consigne enseigne",
  MERCHANDISING: "Mise en avant",
  COMMUNICATION: "Communication",
  MARKET_SIGNAL: "Signal marché",
  PREORDER_WINDOW: "Précommande",
  DELIVERY_WINDOW: "Livraison",
  APPLICABILITY_CONDITION: "Condition d’application",
};
export function commercialIssueMessage(code: string) {
  if (code === "UNSUPPORTED_FIELD")
    return "Cette valeur n’a pas pu être reliée à un extrait source. Vérifiez-la avant de confirmer la transcription.";
  if (code === "DUPLICATE_FIELD")
    return "Plusieurs valeurs ont été proposées pour ce champ. Vérifiez le document.";
  if (code === "UNSUPPORTED_BLOCK")
    return "Un élément sans référence source fiable a été écarté de l’extraction.";
  return "Ce point nécessite un examen du document.";
}
export function commercialWarningMessage(code: string) {
  const labels: Record<string, string> = {
    UNCERTAIN_DATE:
      "Une date est incertaine ou son année manque. Aucune année n’a été ajoutée automatiquement.",
    UNCERTAIN_PRICE: "Un prix nécessite un examen.",
    UNCERTAIN_MECHANISM: "Un mécanisme commercial nécessite un examen.",
    UNCERTAIN_PRODUCT: "Une identité produit nécessite un examen.",
    UNCERTAIN_APPLICABILITY: "L’application au magasin nécessite un examen.",
    NO_EXTRACTABLE_TEXT: "Cette page ne contient pas de texte exploitable.",
    OTHER: "La lecture de cette page nécessite un examen.",
  };
  return labels[code] ?? "La lecture de cette page nécessite un examen.";
}
export function commercialReviewItems(pages: CommercialReviewPage[]) {
  return pages.flatMap((page) =>
    page.blocks.map((block) => ({
      key: `${page.id}:${block.sourceBlockIndex}`,
      page,
      block,
      issues: page.issues.filter(
        (issue) => issue.blockIndex === block.sourceBlockIndex,
      ),
    })),
  );
}

export function commercialMechanismLabel(mechanism: CommercialMechanism) {
  const amount = (value: number) =>
    value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  const unit = (value: string) =>
    ({
      KG: "kg",
      PIECE: "pièce",
      PACK: "unité conditionnée",
      LOT: "lot",
      OTHER: "unité à préciser",
    })[value];
  switch (mechanism.type) {
    case "FIXED_PRICE":
      return `${amount(mechanism.amount)} / ${unit(mechanism.unit)}`;
    case "PRICE_CEILING":
      return `${mechanism.operator === "LESS_THAN" ? "<" : "≤"} ${amount(mechanism.amount)} / ${unit(mechanism.unit)}`;
    case "THRESHOLD_PRICE":
      return `${amount(mechanism.basePrice)} / ${unit(mechanism.priceUnit)} ; ${amount(mechanism.thresholdPrice)} / ${unit(mechanism.priceUnit)} à partir de ${mechanism.thresholdQuantity.toLocaleString("fr-FR")} ${unit(mechanism.thresholdUnit)}`;
    case "CARD_BENEFIT":
      return `${mechanism.benefitType === "PERCENT" ? `${mechanism.value.toLocaleString("fr-FR")} %` : amount(mechanism.value)} sur la carte. Le prix payé en caisse reste distinct.`;
    case "LOT":
      return `Lot de ${mechanism.lotQuantity} ${unit(mechanism.unit)}${mechanism.totalPrice === null ? " · prix à préciser" : ` pour ${amount(mechanism.totalPrice)}`}`;
  }
}
export const commercialConflictLabels: Record<string, string> = {
  SELLING_MECHANISM_CONFLICT:
    "Des prix ou mécanismes différents sont indiqués pour cette offre.",
  SALE_PERIOD_CONFLICT:
    "Des périodes différentes ou incomplètes sont indiquées pour cette offre.",
  PURCHASE_CONDITION_CONFLICT:
    "Des conditions fournisseur différentes sont indiquées pour cette offre.",
  UNRESOLVED_MECHANISM_CONFLICT:
    "Les mécanismes bruts de cette offre diffèrent et restent à préciser.",
};
