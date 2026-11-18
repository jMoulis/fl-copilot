import type { ProductMatchCatalog } from "@fl-copilot/domain";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";

/** One view-owned snapshot, never a publication authority or a durable cache. */
export class MercalysReviewCache {
  private entry?: { key: string; summary: string };
  key(storeId: string, checksum: string, catalog: ProductMatchCatalog) {
    return JSON.stringify([storeId, checksum, catalog]);
  }
  get(key: string): MercalysImportValidationSummary | undefined {
    return this.entry?.key === key ? JSON.parse(this.entry.summary) : undefined;
  }
  put(key: string, summary: MercalysImportValidationSummary) {
    this.entry = { key, summary: JSON.stringify(summary) };
  }
}
