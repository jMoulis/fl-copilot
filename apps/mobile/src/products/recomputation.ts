import type { OutboxDatabase } from "../sync/outbox-repository";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";
export async function queueProductRecomputation(
  tx: OutboxDatabase,
  storeId: string,
  productId: string,
  jobId: string,
  createdAt: string,
) {
  const dates = await tx.getAllAsync<{ business_date: string }>(
    `SELECT business_date FROM sales_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL UNION SELECT business_date FROM waste_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL UNION SELECT business_date FROM product_daily_performance WHERE store_id=? AND product_id=?`,
    storeId,
    productId,
    storeId,
    productId,
    storeId,
    productId,
  );
  if (!dates.length) return null;
  await enqueueAnalyticsRecomputationJob(tx, {
    jobId,
    storeId,
    scopes: dates.map((d) => ({ productId, businessDate: d.business_date })),
    createdAt,
  });
  return jobId;
}
