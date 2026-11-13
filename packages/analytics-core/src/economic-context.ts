import {
  economicMonthSchema,
  shiftEconomicMonth,
  type EconomicContext,
} from "@fl-copilot/domain";
import { BusinessDecimal } from "./decimal";
/** Monthly national context only; never a daily/store causal estimate. */
export function economicPeriodSummary(
  context: EconomicContext | undefined,
  month: string,
) {
  economicMonthSchema.parse(month);
  return (
    context?.series.map((series) => {
      const current = [...series.points]
        .filter((p) => p.period <= month)
        .sort((a, b) => b.period.localeCompare(a.period))[0];
      const reference =
        current &&
        series.points.find(
          (p) => p.period === shiftEconomicMonth(current.period, -12),
        );
      const previous =
        current &&
        series.points.find(
          (p) => p.period === shiftEconomicMonth(current.period, -1),
        );
      const value = current?.value ?? null;
      const annualChangePercent =
        series.id === "011813720" &&
        value !== null &&
        reference?.value !== null &&
        reference?.value !== undefined &&
        new BusinessDecimal(reference.value).gt(0)
          ? new BusinessDecimal(value)
              .minus(reference.value)
              .div(reference.value)
              .times(100)
              .toFixed(2)
          : null;
      const monthlyDifferencePoints =
        series.id === "001587668" &&
        value !== null &&
        previous?.value !== null &&
        previous?.value !== undefined
          ? new BusinessDecimal(value).minus(previous.value).toFixed(2)
          : null;
      return {
        id: series.id,
        requestedMonth: month,
        period: current?.period ?? null,
        value,
        annualChangePercent,
        monthlyDifferencePoints,
        quality: current?.quality ?? null,
        revised: current?.revised ?? false,
        lastUpdated: series.lastUpdated,
      };
    }) ?? []
  );
}
