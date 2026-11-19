import {
  productMatchingSignature,
  type ProductMatchCatalog,
} from "@fl-copilot/domain";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";

/** One source snapshot per database/owner, never a publication authority. */
export class MercalysReviewCache {
  private entry?: { key: string; summary: string };
  key(storeId: string, checksum: string, catalog: ProductMatchCatalog) {
    return JSON.stringify([
      "mercalys-codes-v1",
      storeId,
      checksum,
      productMatchingSignature(storeId, catalog),
      catalog.products
        .filter((p) => p.storeId === storeId && !p.deletedAt)
        .map((p) => [p.id, p.status])
        .sort(),
      catalog.identifiers
        .filter((i) => i.storeId === storeId && !i.deletedAt)
        .map((i) => [i.productId, i.type, i.value, i.status])
        .sort(),
    ]);
  }
  get(key: string): MercalysImportValidationSummary | undefined {
    return this.entry?.key === key ? JSON.parse(this.entry.summary) : undefined;
  }
  put(key: string, summary: MercalysImportValidationSummary) {
    this.entry = { key, summary: JSON.stringify(summary) };
  }
}

// Retain the last file through route unmounts, but never through database/owner changes.
const caches = new WeakMap<
  object,
  { scope: string; cache: MercalysReviewCache }
>();
export function getMercalysReviewCache(
  database: object,
  storeId: string,
  ownerId: string,
) {
  const scope = JSON.stringify([storeId, ownerId]);
  let entry = caches.get(database);
  if (entry?.scope !== scope) {
    entry = { scope, cache: new MercalysReviewCache() };
    caches.set(database, entry);
  }
  return entry.cache;
}
