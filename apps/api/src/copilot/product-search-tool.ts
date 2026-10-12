import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotProductSearchInputSchema,
  copilotProductSearchResultSchema,
  copilotEvidenceSchema,
  normalizeProductLabel,
  searchCopilotProducts,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  serializeProductAliasDocument,
  serializeProductIdentifierDocument,
  type ProductDocument,
  type ProductAliasDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";
export async function readProductSearch(db: Db, storeId: string, raw: unknown) {
  z.string().uuid().parse(storeId);
  const input = copilotProductSearchInputSchema.parse(raw);
  const [rows, identifiers, aliases] = await Promise.all([
    db
      .collection<ProductDocument>("products")
      .find({ storeId, status: "ACTIVE", deletedAt: null })
      .maxTimeMS(2000)
      .limit(1001)
      .toArray(),
    input.identifiers.length
      ? db
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .find({
            storeId,
            status: "VALIDATED",
            deletedAt: null,
            $or: input.identifiers.map((i) => ({
              type: i.type,
              value: i.value,
            })),
          })
          .maxTimeMS(2000)
          .limit(101)
          .toArray()
      : [],
    input.label
      ? db
          .collection<ProductAliasDocument>("productAliases")
          .find({
            storeId,
            status: "VALIDATED",
            deletedAt: null,
            normalizedAlias: normalizeProductLabel(input.label),
          })
          .maxTimeMS(2000)
          .limit(101)
          .toArray()
      : [],
  ]);
  const limited =
    rows.length > 1000 || identifiers.length > 100 || aliases.length > 100;
  const catalog = {
    products: limited ? [] : rows.map(serializeProductDocument),
    identifiers: limited
      ? []
      : identifiers.map(serializeProductIdentifierDocument),
    aliases: limited ? [] : aliases.map(serializeProductAliasDocument),
  };
  if (
    [...catalog.products, ...catalog.identifiers, ...catalog.aliases].some(
      (e) => e.storeId !== storeId,
    )
  )
    throw Error("COPILOT_SEARCH_SCOPE_INVALID");
  const found = limited
    ? {
        state: null,
        matchedProductId: null,
        candidates: [],
        candidateCount: null,
        hasMoreCandidates: false,
        missingIdentifiers: [],
      }
    : searchCopilotProducts(storeId, input, catalog);
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        catalog.products.map((p) => [p.id, p.version, p.label]).sort(),
        catalog.identifiers,
        catalog.aliases,
        limited,
      ]),
    )
    .digest("hex");
  const categories = {
    FRUIT: "Fruit",
    VEGETABLE: "Légume",
    OTHER: "Autre",
    UNKNOWN: "Non précisée",
  };
  const natures = {
    BULK: "Vrac",
    PACKAGED: "Conditionné",
    UNKNOWN: "Non précisée",
  };
  const units = {
    KG: "kg",
    PIECE: "pièce",
    PACK: "unité conditionnée",
    UNKNOWN: "Non précisée",
  };
  const bases = {
    EXACT_IDENTIFIER: "Code exact validé",
    VALIDATED_ALIAS: "Alias validé",
    CANONICAL_LABEL: "Libellé exact",
    FUZZY_LABEL: "Nom proche",
    LABEL_TERMS: "Termes du nom",
  };
  const states = {
    AUTO_MATCH: "Identité exacte retrouvée",
    REVIEW: "Identité à confirmer",
    AMBIGUOUS: "Plusieurs identités possibles",
    NO_MATCH: "Aucune correspondance retrouvée",
  };
  const evidence = found.candidates.map((c) =>
    copilotEvidenceSchema.parse({
      id: JSON.stringify(["product-search", storeId, revision, c.product.id]),
      sourceType: "DATA_QUALITY",
      sourceId: c.product.id,
      sourceVersion: c.product.version || null,
      label: `Fiche produit — ${c.product.label}`,
      value: `Catégorie : ${categories[c.product.category]} ; nature : ${natures[c.product.nature]} ; unité de vente : ${units[c.product.salesUnit]} ; correspondance : ${bases[c.basis]}${c.basis === "LABEL_TERMS" || c.basis === "FUZZY_LABEL" ? " (proposition à confirmer)" : ""}. Aucun produit n’a été modifié.`,
      factKind: "QUALITY",
    }),
  );
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `product-search-coverage/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: "Périmètre de recherche produit",
      value: limited
        ? "Limite de lecture du catalogue dépassée ; aucune identité ni absence de résultat ne peut être conclue sur un échantillon."
        : `${found.candidateCount} candidats ; état : ${found.state ? states[found.state] : "Recherche incomplète"}${found.hasMoreCandidates ? " ; seuls les premiers candidats sont présentés, préciser le nom ou un code" : ""}. Produits actifs du magasin, codes et alias validés uniquement. ${found.missingIdentifiers.length} codes fournis sans correspondance exacte validée. Une suggestion par nom ne valide pas un produit et n’autorise aucune modification.`,
      factKind: "QUALITY",
    }),
  );
  return copilotProductSearchResultSchema.parse({
    status: limited ? "LIMIT_EXCEEDED" : "COMPLETE_CATALOG",
    ...found,
    evidence,
  });
}
