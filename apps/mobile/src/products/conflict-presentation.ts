import {
  catalogueConflictSchemas,
  type CatalogueConflictKind,
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
} from "@fl-copilot/domain";
const statuses = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  TO_REVIEW: "À confirmer",
  VALIDATED: "Validé",
  REJECTED: "Refusé",
};
const sources = {
  USER: "Saisie magasin",
  MERCALYS: "Export Mercalys",
  WASTE_RECEIPT: "Ticket de casse",
  COMMERCIAL_PDF: "Document commercial",
  AI_PROPOSED: "Proposition IA",
};
const units = {
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
  UNKNOWN: "à préciser",
};
export function catalogueConflictSummary(
  kind: CatalogueConflictKind,
  raw: unknown,
  products: Record<string, string> = {},
) {
  const e = catalogueConflictSchemas[kind].parse(raw);
  if (kind === "PRODUCT") {
    const p = productSchema.parse(e);
    return `${p.label} · version ${p.version}\n${{ FRUIT: "Fruit", VEGETABLE: "Légume", OTHER: "Autre", UNKNOWN: "Catégorie à préciser" }[p.category]} · ${{ BULK: "Vrac", PACKAGED: "Conditionné", UNKNOWN: "Nature à préciser" }[p.nature]} · ${units[p.salesUnit]}\nConditionnement : ${p.packaging ? `${p.packaging.quantity} ${p.packaging.unit}${p.packaging.sourceLabel ? ` · ${p.packaging.sourceLabel}` : ""}` : "non renseigné"}\n${statuses[p.status]}${p.deletedAt ? " · supprimé" : ""}\nFamille : ${p.familyId ?? "non renseignée"} · Sous-famille : ${p.subfamilyId ?? "non renseignée"}`;
  }
  if (kind === "IDENTIFIER") {
    const id = productIdentifierSchema.parse(e);
    return `${id.type} : ${id.value}\nProduit : ${products[id.productId] ?? "Fiche indisponible"}\n${statuses[id.status]} · origine ${sources[id.source]} · version ${id.version}${id.deletedAt ? " · supprimé" : ""}`;
  }
  const a = productAliasSchema.parse(e);
  return `${a.alias}\nProduit : ${products[a.productId] ?? "Fiche indisponible"}\n${statuses[a.status]} · origine ${sources[a.source]} · version ${a.version}${a.deletedAt ? " · supprimé" : ""}\nConfiance enregistrée : ${a.confidence ?? "non renseignée"}`;
}
