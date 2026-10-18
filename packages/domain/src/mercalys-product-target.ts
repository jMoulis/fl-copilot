import type { ProductMatchCatalog } from "./product-matching";
import { normalizeProductLabel, type ProductIdentifier } from "./products";

export type MercalysTargetSource = {
  label: string;
  identifiers: readonly Pick<ProductIdentifier, "type" | "value">[];
};

/** A human may select outside matcher suggestions, never silently move an identity. */
export function mercalysProductTargetBlocker(
  storeId: string,
  source: MercalysTargetSource,
  productId: string,
  catalog: ProductMatchCatalog,
) {
  const product = catalog.products.find(
    (p) => p.id === productId && p.storeId === storeId && !p.deletedAt,
  );
  if (!product || product.status !== "ACTIVE")
    return "PRODUCT_UNAVAILABLE" as const;
  for (const sourceIdentifier of source.identifiers) {
    const owners = catalog.identifiers.filter(
      (i) =>
        i.storeId === storeId &&
        !i.deletedAt &&
        i.type === sourceIdentifier.type &&
        i.value === sourceIdentifier.value,
    );
    if (owners.some((i) => i.productId !== productId))
      return "IDENTIFIER_OWNED" as const;
    if (owners.some((i) => i.status !== "VALIDATED"))
      return "IDENTITY_REVIEW_REQUIRED" as const;
  }
  if (
    !source.identifiers.length &&
    catalog.aliases.some(
      (a) =>
        a.storeId === storeId &&
        !a.deletedAt &&
        a.normalizedAlias === normalizeProductLabel(source.label) &&
        (a.productId !== productId || a.status !== "VALIDATED"),
    )
  )
    return "ALIAS_REVIEW_REQUIRED" as const;
  return null;
}

/** Local search is discovery only: returning a product never authorizes its selection. */
export function searchMercalysProductTargets(
  storeId: string,
  catalog: ProductMatchCatalog,
  query: string,
) {
  const tokens = normalizeProductLabel(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { products: [], total: 0 };
  const terms = new Map<string, string[]>();
  const add = (id: string, value: string) => {
    const values = terms.get(id) ?? [];
    values.push(normalizeProductLabel(value));
    terms.set(id, values);
  };
  for (const i of catalog.identifiers)
    if (i.storeId === storeId && !i.deletedAt) add(i.productId, i.value);
  for (const a of catalog.aliases)
    if (a.storeId === storeId && !a.deletedAt && a.status === "VALIDATED")
      add(a.productId, a.alias);
  const products = catalog.products
    .filter(
      (p) =>
        p.storeId === storeId &&
        p.status === "ACTIVE" &&
        !p.deletedAt &&
        tokens.every((token) =>
          [normalizeProductLabel(p.label), ...(terms.get(p.id) ?? [])].some(
            (value) => value.includes(token),
          ),
        ),
    )
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, "fr") || a.id.localeCompare(b.id),
    );
  return { products: products.slice(0, 20), total: products.length };
}
