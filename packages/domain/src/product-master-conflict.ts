import {
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
} from "./products";
export const catalogueConflictKinds = [
  "PRODUCT",
  "IDENTIFIER",
  "ALIAS",
] as const;
export type CatalogueConflictKind = (typeof catalogueConflictKinds)[number];
export const catalogueConflictSchemas = {
  PRODUCT: productSchema,
  IDENTIFIER: productIdentifierSchema,
  ALIAS: productAliasSchema,
};
export const catalogueConflictTypes = {
  PRODUCT: "product",
  IDENTIFIER: "product_identifier",
  ALIAS: "product_alias",
} as const;
export const catalogueConflictTables = {
  PRODUCT: "products",
  IDENTIFIER: "product_identifiers",
  ALIAS: "product_aliases",
} as const;
export function isCatalogueConflictKind(
  kind: string,
): kind is CatalogueConflictKind {
  return (catalogueConflictKinds as readonly string[]).includes(kind);
}
export function catalogueConflictIdentity(
  kind: CatalogueConflictKind,
  left: unknown,
  right: unknown,
) {
  const l = catalogueConflictSchemas[kind].parse(left),
    r = catalogueConflictSchemas[kind].parse(right);
  return (
    l.id === r.id &&
    l.storeId === r.storeId &&
    (kind === "PRODUCT" ||
      ("productId" in l &&
        "productId" in r &&
        l.productId === r.productId &&
        l.source === r.source))
  );
}
/** Preserve the synchronized creation metadata and alias confidence, never create identity links. */
export function rebaseCatalogueConflict(
  kind: CatalogueConflictKind,
  local: unknown,
  remote: unknown,
  at: string,
) {
  if (!catalogueConflictIdentity(kind, local, remote))
    throw Error("CATALOGUE_CONFLICT_IDENTITY");
  const l = catalogueConflictSchemas[kind].parse(local),
    r = catalogueConflictSchemas[kind].parse(remote);
  return catalogueConflictSchemas[kind].parse({
    ...l,
    createdAt: r.createdAt,
    version: r.version + 1,
    updatedAt: at,
    ...(kind === "ALIAS"
      ? { confidence: productAliasSchema.parse(r).confidence ?? null }
      : {}),
  });
}
