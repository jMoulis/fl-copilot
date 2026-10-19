import { z } from "zod";
import { normalizeProductLabel } from "@fl-copilot/domain";
import type { ProductListItem } from "./product-editor-hooks.types";
import type { OutboxDatabase } from "../sync/outbox-repository";

export const catalogueViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  query: z.string().max(200),
  category: z.enum(["ALL", "FRUIT", "VEGETABLE", "OTHER", "UNKNOWN"]),
  nature: z.enum(["ALL", "BULK", "PACKAGED", "UNKNOWN"]),
  state: z.enum(["ALL", "INCOMPLETE", "PENDING", "CONFLICT", "INACTIVE"]),
  scroll: z.number().min(0).max(10000000),
});
export type CatalogueView = z.infer<typeof catalogueViewSchema>;
export const initialCatalogueView: CatalogueView = {
  schemaVersion: 1,
  query: "",
  category: "ALL",
  nature: "ALL",
  state: "ALL",
  scroll: 0,
};
export function productIsIncomplete(p: ProductListItem["record"]["entity"]) {
  return (
    p.category === "UNKNOWN" ||
    p.nature === "UNKNOWN" ||
    p.salesUnit === "UNKNOWN"
  );
}
export function filterCatalogue(items: ProductListItem[], view: CatalogueView) {
  const query = normalizeProductLabel(view.query);
  return items.filter(({ record, conflictId, searchTerms }) => {
    const p = record.entity;
    return (
      (!query ||
        [p.label, ...(searchTerms ?? [])].some((s) =>
          normalizeProductLabel(s).includes(query),
        )) &&
      (view.category === "ALL" || p.category === view.category) &&
      (view.nature === "ALL" || p.nature === view.nature) &&
      (view.state === "ALL" ||
        (view.state === "INCOMPLETE" && productIsIncomplete(p)) ||
        (view.state === "PENDING" && record.dirty) ||
        (view.state === "CONFLICT" && Boolean(conflictId)) ||
        (view.state === "INACTIVE" && p.status === "INACTIVE"))
    );
  });
}
export const categoryLabels = {
  FRUIT: "Fruit",
  VEGETABLE: "Légume",
  OTHER: "Autre",
  UNKNOWN: "Catégorie à préciser",
};
export const natureLabels = {
  BULK: "Vrac",
  PACKAGED: "Conditionné",
  UNKNOWN: "Nature à préciser",
};
export const unitLabels = {
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
  UNKNOWN: "Unité à préciser",
};

/** Private UI state only; never enqueues business commands. */
export class CatalogueViewRepository {
  private readonly key: string;
  constructor(
    private db: OutboxDatabase,
    scope: { storeId: string; ownerId: string },
  ) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.ownerId);
    this.key = `catalogue-view:v1:${scope.storeId}:${scope.ownerId}`;
  }
  async read() {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    );
    return row ? catalogueViewSchema.parse(JSON.parse(row.value)) : null;
  }
  async save(raw: CatalogueView) {
    const view = catalogueViewSchema.parse(raw);
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      this.key,
      JSON.stringify(view),
      new Date().toISOString(),
    );
  }
}
