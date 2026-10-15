import { calculateCalendarPeriodComparison } from "./calendar-period-comparison";
import type { DatePeriod, DatedKpiValue } from "./comparison";
import { parseDecimal, serializeDecimal } from "./decimal";

/** Ratio of period sums, never daily ratios or the intersection of reporting dates. */
export function calculatePeriodWasteRate(input: {
  period: DatePeriod;
  sales: readonly DatedKpiValue[];
  waste: readonly DatedKpiValue[];
}) {
  const read = (points: readonly DatedKpiValue[], kpiId: string) =>
    calculateCalendarPeriodComparison({
      kpiId,
      points,
      currentPeriod: input.period,
      referencePeriod: null,
      aggregation: "SUM",
    });
  const sales = read(input.sales, "sales"),
    waste = read(input.waste, "waste");
  const salesTotal = sales.comparison.currentValue,
    wasteTotal = waste.comparison.currentValue;
  const reason =
    salesTotal === null || wasteTotal === null
      ? ("MISSING_INPUT" as const)
      : parseDecimal(salesTotal).value.lessThanOrEqualTo(0)
        ? ("NON_POSITIVE_SALES" as const)
        : null;
  return {
    period: input.period,
    basis: "RECORDED_WASTE_SALES_VALUE_OVER_NET_SALES" as const,
    salesTotal,
    wasteTotal,
    percentage: reason
      ? null
      : serializeDecimal(
          parseDecimal(wasteTotal!)
            .value.dividedBy(parseDecimal(salesTotal!).value)
            .times(100),
          2,
        ),
    status: reason
      ? ("UNAVAILABLE" as const)
      : sales.currentCoverage.availableDays ===
            sales.currentCoverage.expectedDays &&
          waste.currentCoverage.availableDays ===
            waste.currentCoverage.expectedDays
        ? ("AVAILABLE" as const)
        : ("PARTIAL" as const),
    reason,
    salesCoverage: sales.currentCoverage,
    wasteCoverage: waste.currentCoverage,
  };
}
