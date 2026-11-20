import { BusinessDecimal } from "@fl-copilot/analytics-core";
import { purchasePriceNeedsReview } from "@fl-copilot/domain";
import type { MercalysImportValidationSummary } from "../documents/mercalys-import-validation";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { enqueueMercalysContinuation } from "../documents/mercalys-publication-sync";

export type PurchasePriceRow = {
  id: string;
  amount: string;
  selling_price_ttc?: string | null;
  vat_rate?: string | null;
  reference_status?: "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | null;
  unit: string;
  business_date: string;
  price_status: "KNOWN" | "TO_VERIFY";
  source_document_id: string;
  sync_state: string;
  version: number;
};
export class PurchasePriceRepository {
  constructor(private db: OutboxDatabase & AtomicMutationDatabase) {}
  async history(
    storeId: string,
    productId: string,
    date: string,
    before?: string,
  ) {
    return this.db.getAllAsync<PurchasePriceRow>(
      `SELECT * FROM purchase_price_observations WHERE store_id=? AND product_id=? AND business_date<=? AND (? IS NULL OR business_date<?) AND deleted_at IS NULL ORDER BY business_date DESC,created_at DESC,id DESC LIMIT 20`,
      storeId,
      productId,
      date,
      before ?? null,
      before ?? null,
    );
  }
  async preview(storeId: string, summary: MercalysImportValidationSummary) {
    const previous = await this.db.getAllAsync<
      PurchasePriceRow & { product_id: string }
    >(
      `SELECT * FROM (SELECT p.*, ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY business_date DESC,created_at DESC,id DESC) AS rank FROM purchase_price_observations p WHERE store_id=? AND business_date<=? AND deleted_at IS NULL) WHERE rank=1`,
      storeId,
      summary.businessPeriodStart,
    );
    const products = await this.db.getAllAsync<{
      id: string;
      sales_unit: string;
    }>(
      "SELECT id,sales_unit FROM products WHERE store_id=? AND deleted_at IS NULL",
      storeId,
    );
    const units = new Map(products.map((p) => [p.id, p.sales_unit]));
    const latest = new Map(previous.map((p) => [p.product_id, p]));
    const counts = {
      increased: 0,
      decreased: 0,
      unchanged: 0,
      withoutComparison: 0,
      toVerify: 0,
    };
    for (const line of summary.lines) {
      if (
        line.match.state !== "AUTO_MATCH" ||
        !line.match.matchedProductId ||
        !line.record.purchasePrice
      )
        continue;
      const unit = units.get(line.match.matchedProductId),
        amount = line.record.purchasePrice.amount;
      if (!unit || unit === "UNKNOWN" || purchasePriceNeedsReview(amount)) {
        counts.toVerify++;
        continue;
      }
      const prior = latest.get(line.match.matchedProductId);
      if (!prior || prior.price_status !== "KNOWN" || prior.unit !== unit) {
        counts.withoutComparison++;
        continue;
      }
      const comparison = new BusinessDecimal(amount).comparedTo(prior.amount);
      counts[
        comparison > 0
          ? "increased"
          : comparison < 0
            ? "decreased"
            : "unchanged"
      ]++;
    }
    return counts;
  }
  async confirm(
    storeId: string,
    productId: string,
    id: string,
    version: number,
    ctx: { now: string; generateId(): string; assertCurrentScope(): void },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      ctx.assertCurrentScope();
      const row = await tx.getFirstAsync<PurchasePriceRow>(
        "SELECT * FROM purchase_price_observations WHERE store_id=? AND product_id=? AND id=? AND deleted_at IS NULL",
        storeId,
        productId,
        id,
      );
      if (
        !row ||
        row.version !== version ||
        row.unit === "UNKNOWN" ||
        row.reference_status === "TEMPORARILY_UNAVAILABLE"
      )
        throw Error("PURCHASE_PRICE_CHANGED");
      if (row.price_status === "KNOWN") return;
      const conflict = await tx.getFirstAsync(
        "SELECT command_id FROM sync_outbox WHERE store_id=? AND entity_type='mercalys_publication' AND entity_id=? AND status IN ('CONFLICT','FAILED')",
        storeId,
        row.source_document_id,
      );
      if (conflict) throw Error("MERCALYS_CONTINUATION_CONFLICT");
      await tx.runAsync(
        "UPDATE purchase_price_observations SET price_status='KNOWN',confirmed_at=?,version=version+1,updated_at=?,sync_state='PENDING',dirty=1 WHERE id=? AND store_id=?",
        ctx.now,
        ctx.now,
        id,
        storeId,
      );
      await enqueueMercalysContinuation(
        tx,
        storeId,
        row.source_document_id,
        ctx.generateId,
        ctx.now,
      );
      ctx.assertCurrentScope();
    });
  }
}
