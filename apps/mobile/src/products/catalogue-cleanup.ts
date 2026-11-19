import { ProductMasterRepository } from "./product-master-repository";
import { productMutationExpectedRemoteVersion } from "./product-editor-service";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

type Db = OutboxDatabase & AtomicMutationDatabase;
export async function readCatalogueCleanup(
  db: Db,
  storeId: string,
  through: string,
) {
  const [products, sales, coverage, prices, latestPrice] = await Promise.all([
    new ProductMasterRepository(db).listProducts(storeId),
    db.getAllAsync<{ product_id: string; last_sale: string }>(
      `SELECT product_id,MAX(business_date) AS last_sale FROM sales_observations WHERE store_id=? AND deleted_at IS NULL AND validation_status='VALIDATED' AND business_date<=? AND (CAST(quantity AS REAL)>0 OR CAST(sales_value AS REAL)>0) GROUP BY product_id`,
      storeId,
      through,
    ),
    db.getFirstAsync<{
      first_date: string | null;
      last_date: string | null;
      days: number;
    }>(
      `SELECT MIN(business_date) AS first_date,MAX(business_date) AS last_date,COUNT(DISTINCT business_date) AS days FROM sales_observations WHERE store_id=? AND deleted_at IS NULL AND validation_status='VALIDATED' AND business_date<=?`,
      storeId,
      through,
    ),
    db.getAllAsync<{ product_id: string; last_price: string }>(
      `SELECT product_id,MAX(business_date) AS last_price FROM purchase_price_observations WHERE store_id=? AND deleted_at IS NULL AND validation_status='VALIDATED' AND business_date<=? GROUP BY product_id`,
      storeId,
      through,
    ),
    db.getFirstAsync<{ business_date: string; source_document_id: string }>(
      `SELECT business_date,source_document_id FROM purchase_price_observations WHERE store_id=? AND deleted_at IS NULL AND validation_status='VALIDATED' AND business_date<=? ORDER BY business_date DESC,created_at DESC,source_document_id DESC LIMIT 1`,
      storeId,
      through,
    ),
  ]);
  const latestRows = latestPrice
    ? await db.getAllAsync<{ product_id: string }>(
        "SELECT DISTINCT product_id FROM purchase_price_observations WHERE store_id=? AND source_document_id=? AND deleted_at IS NULL AND validation_status='VALIDATED'",
        storeId,
        latestPrice.source_document_id,
      )
    : [];
  const present = new Set(latestRows.map((p) => p.product_id));
  const saleById = new Map(sales.map((s) => [s.product_id, s.last_sale]));
  const priceById = new Map(prices.map((p) => [p.product_id, p.last_price]));
  return {
    coverage,
    latestPriceDate: latestPrice?.business_date ?? null,
    items: products.map((record) => ({
      record,
      lastSale: saleById.get(record.entity.id) ?? null,
      lastPrice: priceById.get(record.entity.id) ?? null,
      inLatestPrice: present.has(record.entity.id),
    })),
  };
}
export type CleanupSnapshot = Awaited<ReturnType<typeof readCatalogueCleanup>>;
export type CleanupItem = CleanupSnapshot["items"][number];

/** Explicit reversible status changes only. Observations and codes are retained. */
export async function setCatalogueArchived(
  db: Db,
  selection: readonly CleanupItem[],
  archived: boolean,
  context: {
    storeId: string;
    deviceId: string;
    now(): string;
    id(): string;
    assertCurrent(): void;
    through?: string;
  },
) {
  if (!selection.length) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    context.assertCurrent();
    const repo = new ProductMasterRepository(joinedMutationDatabase(tx));
    for (const selected of selection) {
      const current = await repo.getProduct(selected.record.entity.id);
      if (
        !current ||
        current.entity.storeId !== context.storeId ||
        current.entity.deletedAt ||
        current.entity.version !== selected.record.entity.version ||
        ["ERROR", "CONFLICT"].includes(current.syncState)
      )
        throw Error("CATALOGUE_CLEANUP_CHANGED");
      const conflict = await tx.getFirstAsync(
        "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_type='product' AND entity_id=? AND status='OPEN'",
        context.storeId,
        current.entity.id,
      );
      if (conflict) throw Error("CATALOGUE_CLEANUP_CHANGED");
      if (archived) {
        const sale = await tx.getFirstAsync<{ last_sale: string | null }>(
          "SELECT MAX(business_date) AS last_sale FROM sales_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL AND validation_status='VALIDATED' AND business_date<=? AND (CAST(quantity AS REAL)>0 OR CAST(sales_value AS REAL)>0)",
          context.storeId,
          current.entity.id,
          context.through ?? context.now().slice(0, 10),
        );
        if ((sale?.last_sale ?? null) !== selected.lastSale)
          throw Error("CATALOGUE_CLEANUP_ACTIVITY_CHANGED");
      }

      context.assertCurrent();
      if (current.entity.status === (archived ? "INACTIVE" : "ACTIVE"))
        continue;
      await repo.upsertProduct(
        {
          ...current.entity,
          status: archived ? "INACTIVE" : "ACTIVE",
          version: current.entity.version + 1,
          updatedAt: context.now(),
        },
        {
          commandId: context.id(),
          deviceId: context.deviceId,
          expectedRemoteVersion: productMutationExpectedRemoteVersion(current),
        },
      );
    }
    context.assertCurrent();
  });
}
