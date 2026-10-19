import { z } from "zod";
import {
  analyticsExplorerMetricSchema,
  type AnalyticsExplorerMetric,
  copilotBusinessDateSchema,
} from "@fl-copilot/domain";
import {
  compareExplorerPeriod,
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
export class ExplorerRepository {
  constructor(private db: OutboxDatabase & AtomicMutationDatabase) {}
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
  ) {
    z.uuid().parse(storeId);
    analyticsExplorerMetricSchema.parse(metric);
    const range = explorerRange(period),
      reference = explorerReference(period),
      rr = reference ? explorerRange(reference) : range;
    let result: ReturnType<typeof compareExplorerPeriod> | undefined;
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
      result = compareExplorerPeriod({ period, today, kpiId: metric, points });
    });
    if (!result) throw Error("EXPLORER_UNAVAILABLE");
    return result;
  }
}
