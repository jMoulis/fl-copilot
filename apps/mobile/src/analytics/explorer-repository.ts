import { z } from "zod";
import {
  analyticsExplorerMetricSchema,
  analyticsExplorerFiltersSchema,
  emptyExplorerFilters,
  type AnalyticsExplorerFilters,
  type AnalyticsExplorerMetric,
  copilotBusinessDateSchema,
} from "@fl-copilot/domain";
import {
  compareExplorerPeriod,
  analyzeExplorerProducts,
  explorerHasFilters,
  analyticsQueryProductSchema,
  EXPLORER_PRODUCT_LIMITS,
  type AnalyticsQueryPoint,
  explorerRange,
  explorerReference,
  parseDecimal,
  type ExplorerPeriod,
  type DatedKpiValue,
} from "@fl-copilot/analytics-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
const money = z
    .string()
    .refine((v) => {
      try {
        parseDecimal(v);
        return true;
      } catch {
        return false;
      }
    })
    .nullable(),
  availability = z.object({
    status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  });
const daily = z.object({
  storeId: z.uuid(),
  date: copilotBusinessDateSchema,
  sales: z.object({ salesValue: money, marginValue: money }),
  waste: z.object({ salesValue: money }),
  availability: z.object({
    salesValue: availability,
    salesMarginValue: availability,
    wasteSalesValue: availability,
  }),
  formulaVersion: z.literal("department-daily-v1"),
  computedAt: z.iso.datetime(),
});
const productDaily = daily.extend({
  productId: z.uuid(),
  formulaVersion: z.literal("product-daily-v1"),
});
export class ExplorerRepository {
  constructor(private db: OutboxDatabase & AtomicMutationDatabase) {}
  async catalogue(storeId: string) {
    z.uuid().parse(storeId);
    const rows = await this.db.getAllAsync<{
      id: string;
      label: string;
      category: unknown;
      nature: unknown;
    }>(
      "SELECT id,label,category,nature FROM products WHERE store_id=? ORDER BY label,id LIMIT 10001",
      storeId,
    );
    if (rows.length > EXPLORER_PRODUCT_LIMITS.products)
      throw Error("EXPLORER_DETAILS_LIMIT");
    return rows.map((p) => analyticsQueryProductSchema.parse(p));
  }
  async latestDate(storeId: string) {
    z.uuid().parse(storeId);
    const r = await this.db.getFirstAsync<{ business_date: string }>(
      "SELECT business_date FROM department_daily_performance WHERE store_id=? ORDER BY business_date DESC LIMIT 1",
      storeId,
    );
    return r ? copilotBusinessDateSchema.parse(r.business_date) : null;
  }
  async load(
    storeId: string,
    period: ExplorerPeriod,
    metric: AnalyticsExplorerMetric,
    today: string,
    filters: AnalyticsExplorerFilters = emptyExplorerFilters(),
    offset = 0,
  ) {
    z.uuid().parse(storeId);
    analyticsExplorerMetricSchema.parse(metric);
    filters = analyticsExplorerFiltersSchema.parse(filters);
    const range = explorerRange(period),
      reference = explorerReference(period),
      rr = reference ? explorerRange(reference) : range;
    let result:
      | (ReturnType<typeof compareExplorerPeriod> & {
          filters: AnalyticsExplorerFilters;
          details: ReturnType<typeof analyzeExplorerProducts> | null;
          detailsUnavailable: boolean;
        })
      | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const rows = await tx.getAllAsync<{
        business_date: string;
        payload_json: string;
      }>(
        "SELECT business_date,payload_json FROM department_daily_performance WHERE store_id=? AND ((business_date BETWEEN ? AND ?) OR (business_date BETWEEN ? AND ?)) ORDER BY business_date LIMIT 733",
        storeId,
        range.start,
        range.end,
        rr.start,
        rr.end,
      );
      if (rows.length > 732) throw Error("EXPLORER_READ_LIMIT");
      const points: DatedKpiValue[] = rows.map((row) => {
        const p = daily.parse(JSON.parse(row.payload_json));
        if (p.storeId !== storeId || p.date !== row.business_date)
          throw Error("EXPLORER_SOURCE_SCOPE");
        const value =
            metric === "sales"
              ? p.sales.salesValue
              : metric === "margin"
                ? p.sales.marginValue
                : p.waste.salesValue,
          status =
            metric === "sales"
              ? p.availability.salesValue.status
              : metric === "margin"
                ? p.availability.salesMarginValue.status
                : p.availability.wasteSalesValue.status;
        return {
          businessDate: p.date,
          value: status === "UNAVAILABLE" ? null : value,
          status,
        };
      });
      const department = compareExplorerPeriod({
        period,
        today,
        kpiId: metric,
        points,
      });
      let details: ReturnType<typeof analyzeExplorerProducts> | null = null;
      let detailsUnavailable = false;
      try {
        const catalogue = await tx.getAllAsync<{
          id: string;
          label: string;
          category: unknown;
          nature: unknown;
        }>(
          "SELECT id,label,category,nature FROM products WHERE store_id=? ORDER BY id LIMIT 10001",
          storeId,
        );
        if (catalogue.length > EXPLORER_PRODUCT_LIMITS.products)
          throw Error("EXPLORER_DETAILS_LIMIT");
        const products = catalogue.map((p) =>
          analyticsQueryProductSchema.parse(p),
        );
        const productPoints: AnalyticsQueryPoint[] = [];
        let afterDate = "",
          afterProduct = "";
        for (;;) {
          const page = await tx.getAllAsync<{
            business_date: string;
            product_id: string;
            payload_json: string;
          }>(
            `SELECT d.business_date,d.product_id,d.payload_json FROM product_daily_performance d
            LEFT JOIN products p ON p.id=d.product_id AND p.store_id=d.store_id
            WHERE d.store_id=? AND ((d.business_date BETWEEN ? AND ?) OR (d.business_date BETWEEN ? AND ?))
            AND (d.business_date > ? OR (d.business_date=? AND d.product_id>?))
            AND (? IS NULL OR p.category=?) AND (? IS NULL OR p.nature=?) AND (? IS NULL OR p.id=?)
            ORDER BY d.business_date,d.product_id LIMIT 5000`,
            storeId,
            range.start,
            range.end,
            rr.start,
            rr.end,
            afterDate,
            afterDate,
            afterProduct,
            filters.category,
            filters.category,
            filters.nature,
            filters.nature,
            filters.productId,
            filters.productId,
          );
          if (
            productPoints.length + page.length >
            EXPLORER_PRODUCT_LIMITS.points
          )
            throw Error("EXPLORER_DETAILS_LIMIT");
          for (const row of page) {
            const p = productDaily.parse(JSON.parse(row.payload_json));
            if (
              p.storeId !== storeId ||
              p.date !== row.business_date ||
              p.productId !== row.product_id
            )
              throw Error("EXPLORER_PRODUCT_SCOPE");
            productPoints.push({
              storeId,
              productId: p.productId,
              businessDate: p.date,
              sales: {
                value: p.sales.salesValue,
                status: p.availability.salesValue.status,
              },
              margin: {
                value: p.sales.marginValue,
                status: p.availability.salesMarginValue.status,
              },
              waste: {
                value: p.waste.salesValue,
                status: p.availability.wasteSalesValue.status,
              },
            });
          }
          if (page.length < 5000) break;
          afterDate = page.at(-1)!.business_date;
          afterProduct = page.at(-1)!.product_id;
        }
        details = analyzeExplorerProducts({
          storeId,
          period,
          metric,
          today,
          filters,
          products,
          points: productPoints,
          offset,
        });
      } catch (e) {
        if (
          !(e instanceof Error) ||
          e.message !== "EXPLORER_DETAILS_LIMIT" ||
          explorerHasFilters(filters)
        )
          throw e;
        detailsUnavailable = true;
      }
      result = {
        ...(explorerHasFilters(filters) ? details!.analysis : department),
        filters,
        details,
        detailsUnavailable,
      };
    });
    if (!result) throw Error("EXPLORER_UNAVAILABLE");
    return result;
  }
}
