import { z } from "zod";
import { copilotAnalysisPeriodSchema } from "./business-dates";
const point = z
  .strictObject({
    value: z
      .string()
      .max(80)
      .regex(/^-?\d+(?:\.\d+)?$/)
      .nullable(),
    status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  })
  .refine((p) => (p.status === "UNAVAILABLE") === (p.value === null));
/** Immutable, server-calculated presentation snapshot; never model-authored values/code. */
export const copilotChartSchema = z
  .strictObject({
    version: z.literal(1),
    type: z.enum(["BARS", "LINE"]),
    title: z.string().min(1).max(160),
    unit: z.enum([
      "EUR",
      "KG",
      "PIECE",
      "PACK",
      "EUR_PER_KG",
      "EUR_PER_PIECE",
      "EUR_PER_PACK",
    ]),
    qualification: z.string().min(1).max(240).optional(),
    labels: z.array(z.string().min(1).max(280)).min(1).max(31),
    series: z
      .array(
        z.strictObject({
          label: z.string().min(1).max(160),
          period: copilotAnalysisPeriodSchema,
          points: z.array(point).min(1).max(31),
        }),
      )
      .min(1)
      .max(2),
  })
  .refine((c) => c.series.every((s) => s.points.length === c.labels.length));
export type CopilotChart = z.infer<typeof copilotChartSchema>;
export const copilotChartRequestSchema = z.strictObject({
  type: z.enum(["BARS", "LINE"]),
  value: z.enum(["AMOUNT", "QUANTITY", "REALIZED_PRICE"]).optional(),
  measure: z.enum(["CURRENT", "CHANGE", "CURRENT_REFERENCE"]),
});

export function chartMatchesContext(
  chart: CopilotChart,
  context: import("./analytics-explorer").AnalyticsExplorerContext,
) {
  const period = context.period;
  if (period.kind !== "range") return false;
  const same = (
    a: { start: string; end: string },
    b: { start: string; end: string } | null,
  ) => !!b && a.start === b.start && a.end === b.end;
  if (
    !same(chart.series[0]!.period, period.current) ||
    (chart.series[1] && !same(chart.series[1].period, period.reference))
  )
    return false;
  return (
    chart.type !== "LINE" ||
    (chart.labels.length ===
      (Date.parse(period.current.end) - Date.parse(period.current.start)) /
        86400000 +
        1 &&
      chart.labels.every(
        (date, i) =>
          date ===
          new Date(Date.parse(period.current.start) + i * 86400000)
            .toISOString()
            .slice(0, 10),
      ))
  );
}
