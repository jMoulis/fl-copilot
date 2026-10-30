import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { DatabaseService } from "../database/types";
import {
  createMongoRemoteAnalyticsRepository,
  RemoteAnalyticsConfirmationService,
  refreshDepartmentCoverage,
} from "./remote-confirmation";

/** Internal derived-work marker, never accepted from a Product DTO or synchronized as an entity. */
export interface ProductUnitRefresh {
  generation: string;
  requestedAt: Date;
  afterDate: string | null;
  leaseId: string | null;
  leaseUntil: Date | null;
  retryAt: Date | null;
}

interface RefreshProduct {
  _id: string;
  storeId: string;
  version: number;
  deletedAt?: Date | null;
  analyticsRefresh: ProductUnitRefresh;
}

const pageSize = 64;
const leaseMs = 60_000;

/** One bounded page; persisted snapshot revisions and cursor make retries harmless. */
export async function refreshProductUnits(
  database: DatabaseService,
  storeId?: string,
  now: () => Date = () => new Date(),
): Promise<{ processed: number; remaining: boolean }> {
  const db = await database.getDb();
  const products = db.collection<RefreshProduct>("products");
  const timestamp = now();
  const leaseId = randomUUID();
  const product = await products.findOneAndUpdate(
    {
      ...(storeId ? { storeId } : {}),
      deletedAt: null,
      "analyticsRefresh.requestedAt": { $exists: true },
      $and: [
        {
          $or: [
            { "analyticsRefresh.leaseUntil": null },
            { "analyticsRefresh.leaseUntil": { $lte: timestamp } },
          ],
        },
        {
          $or: [
            { "analyticsRefresh.retryAt": null },
            { "analyticsRefresh.retryAt": { $lte: timestamp } },
          ],
        },
      ],
    },
    {
      $set: {
        "analyticsRefresh.leaseId": leaseId,
        "analyticsRefresh.leaseUntil": new Date(timestamp.getTime() + leaseMs),
      },
    },
    {
      sort: { "analyticsRefresh.requestedAt": 1, _id: 1 },
      returnDocument: "after",
    },
  );
  if (!product) return { processed: 0, remaining: false };
  const generation = product.analyticsRefresh.generation;
  const owned = {
    _id: product._id,
    storeId: product.storeId,
    deletedAt: null,
    "analyticsRefresh.generation": generation,
    "analyticsRefresh.leaseId": leaseId,
  };
  const deadline = Date.now() + 8_000;
  const assertOwned = async () => {
    if (
      !(await products.findOne(
        {
          ...owned,
          "analyticsRefresh.leaseUntil": { $gt: now() },
        },
        { projection: { _id: 1 } },
      ))
    )
      throw Error("PRODUCT_ANALYTICS_REFRESH_CHANGED");
  };
  let processed = 0;
  try {
    const dates = await refreshDates(
      db,
      product.storeId,
      product._id,
      product.analyticsRefresh.afterDate,
    );
    const scopes = dates
      .slice(0, pageSize)
      .map(({ date }) => ({ productId: product._id, businessDate: date }));
    if (scopes.length) {
      const repository = createMongoRemoteAnalyticsRepository(database);
      const service = new RemoteAnalyticsConfirmationService(
        {
          ...repository,
          async loadProductDay(store, scope) {
            await assertOwned();
            return repository.loadProductDay(store, scope);
          },
          async saveProductDay(performance) {
            await assertOwned();
            await repository.saveProductDay(performance);
          },
        },
        () => now().toISOString(),
      );
      for (let offset = 0; offset < scopes.length; offset += 8) {
        if (processed > 0 && Date.now() >= deadline) break;
        const batch = scopes.slice(offset, offset + 8);
        await service.confirmProducts(product.storeId, batch);
        const checkpoint = await products.updateOne(owned, {
          $set: {
            "analyticsRefresh.afterDate": batch[batch.length - 1]!.businessDate,
          },
        });
        if (checkpoint.matchedCount !== 1)
          throw Error("PRODUCT_ANALYTICS_REFRESH_CHANGED");
        processed += batch.length;
      }
    }
    const remaining = dates.length > pageSize || processed < scopes.length;
    const result = await products.updateOne(
      owned,
      remaining
        ? {
            $set: {
              "analyticsRefresh.leaseId": null,
              "analyticsRefresh.leaseUntil": null,
              "analyticsRefresh.retryAt": null,
            },
          }
        : { $unset: { analyticsRefresh: "" } },
    );
    if (result.matchedCount !== 1)
      throw Error("PRODUCT_ANALYTICS_REFRESH_CHANGED");
    return { processed, remaining };
  } catch {
    // A failed page retains its cursor; the same canonical observations are reread next time.
    await products.updateOne(owned, {
      $set: { "analyticsRefresh.retryAt": new Date(now().getTime() + 30_000) },
    });
    console.warn("PRODUCT_ANALYTICS_REFRESH_DEFERRED");
    return { processed, remaining: true };
  } finally {
    // A newer unit correction retains this lease until the former owner has stopped writing.
    await products.updateOne(
      {
        _id: product._id,
        storeId: product.storeId,
        "analyticsRefresh.leaseId": leaseId,
      },
      {
        $set: {
          "analyticsRefresh.leaseId": null,
          "analyticsRefresh.leaseUntil": null,
        },
      },
    );
  }
}

async function refreshDates(
  db: Db,
  storeId: string,
  productId: string,
  afterDate: string | null,
) {
  const match = {
    storeId,
    productId,
    ...(afterDate ? { date: { $gt: afterDate } } : {}),
  };
  return db
    .collection("productDailyPerformance")
    .aggregate<{ date: string }>(
      [
        { $match: match },
        { $project: { _id: 0, date: 1 } },
        ...["salesObservations", "wasteObservations"].map((coll) => ({
          $unionWith: {
            coll,
            pipeline: [
              {
                $match: {
                  ...match,
                  validationStatus: "VALIDATED",
                  deletedAt: null,
                },
              },
              { $project: { _id: 0, date: 1 } },
            ],
          },
        })),
        { $group: { _id: "$date" } },
        { $sort: { _id: 1 } },
        { $limit: pageSize + 1 },
        { $project: { _id: 0, date: "$_id" } },
      ],
      { maxTimeMS: 5_000 },
    )
    .toArray();
}

/** Projection failure must not turn an already committed business command into a failed save. */
export async function advanceProductUnitRefresh(
  database: DatabaseService,
  storeId?: string,
  now?: () => Date,
) {
  try {
    const result = await refreshProductUnits(database, storeId, now);
    await refreshDepartmentCoverage(database, storeId, now);
    return result;
  } catch {
    console.warn("PRODUCT_ANALYTICS_REFRESH_DEFERRED");
    return { processed: 0, remaining: true };
  }
}
