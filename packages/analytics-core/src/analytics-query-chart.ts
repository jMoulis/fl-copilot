import { calculateSalesMeasures } from "./sales-measures";
import {
  copilotChartSchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import {
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
  type AnalyticsQueryProduct,
} from "./analytics-query";
import { explorerDays, addExplorerDays } from "./explorer-period";
import { previousIsoYearDate } from "./comparison";
const titles = {
  sales: "Chiffre d’affaires net",
  margin: "Marge",
  waste: "Casse au prix de vente",
};
type Result = ReturnType<typeof executeAnalyticsQuery>;
export function buildAnalyticsQueryChart(input: {
  storeId: string;
  query: CopilotAnalyticsQuery;
  products: readonly AnalyticsQueryProduct[];
  points: readonly AnalyticsQueryPoint[];
  result: Result;
}) {
  const { query, result } = input,
    request = query.chart;
  if (!request || !result.rows.length) return undefined;
  const metric = query.metrics[0]!;
  if ((request.value ?? "AMOUNT") !== "AMOUNT") {
    const field =
      request.value === "QUANTITY" ? "quantity" : "averageRealizedPrice";
    const selected = query.filters.productIds?.[0];
    if (request.type === "LINE" && !result.rows.some((r) => r.key === selected))
      return undefined;
    const days = explorerDays(query.currentPeriod);
    const periodSeries = [
      query.currentPeriod,
      ...(request.measure === "CURRENT_REFERENCE"
        ? [query.referencePeriod!]
        : []),
    ];
    if (
      request.type === "LINE" &&
      periodSeries.some((p) => explorerDays(p).length !== days.length)
    )
      return undefined;
    const units = new Set<string>();
    const series = periodSeries.map((period, index) => {
      const measures =
        request.type === "BARS"
          ? result.rows.map(
              (r) =>
                (index
                  ? r.salesMeasures?.reference
                  : r.salesMeasures?.current)?.[field],
            )
          : days.map((day, i) => {
              const date = index
                ? query.referenceMode === "ISO_YEAR"
                  ? previousIsoYearDate(day)
                  : addExplorerDays(period.start, i)
                : day;
              return date
                ? calculateSalesMeasures(
                    { start: date, end: date },
                    input.points.filter(
                      (p) =>
                        p.productId === selected && p.businessDate === date,
                    ),
                  )[field]
                : undefined;
            });
      for (const m of measures)
        if (m?.unit && m.unit !== "UNKNOWN" && m.value !== null)
          units.add(m.unit);
      return {
        label: index ? "Référence" : "Période étudiée",
        period,
        points: measures.map((m) => ({
          value: m?.status === "UNAVAILABLE" ? null : (m?.value ?? null),
          status: !m || m.value === null ? ("UNAVAILABLE" as const) : m.status,
        })),
      };
    });
    const unit = [...units][0];
    if (
      units.size !== 1 ||
      !["KG", "PIECE", "PACK"].includes(unit ?? "") ||
      !series[0]?.points.length
    )
      return undefined;
    return copilotChartSchema.parse({
      version: 1,
      type: request.type,
      title:
        request.value === "QUANTITY"
          ? "Quantité vendue enregistrée"
          : "Prix de vente moyen réalisé",
      unit: request.value === "QUANTITY" ? unit : `EUR_PER_${unit}`,
      qualification:
        request.value === "QUANTITY"
          ? "Unités enregistrées, sans conversion."
          : "Prix réalisé pondéré sur les mêmes journées exploitables ; base HT/TTC non confirmée.",
      labels: request.type === "BARS" ? result.rows.map((r) => r.label) : days,
      series,
    });
  }

  const point = (
    value: string | null,
    coverage: { partialDays: number; missingDays: number } | null,
  ) => ({
    value,
    status:
      value === null
        ? ("UNAVAILABLE" as const)
        : !coverage || coverage.partialDays || coverage.missingDays
          ? ("PARTIAL" as const)
          : ("AVAILABLE" as const),
  });
  let labels: string[],
    series: {
      label: string;
      period: typeof query.currentPeriod;
      points: ReturnType<typeof point>[];
    }[];
  if (request.type === "BARS") {
    labels = result.rows.map((r) => r.label);
    const values = (side: "CURRENT" | "REFERENCE" | "CHANGE") =>
      result.rows.map((r) => {
        const m = r.metrics.find((m) => m.metric === metric)!;
        return side === "CURRENT"
          ? point(m.current, m.currentCoverage)
          : side === "REFERENCE"
            ? point(m.reference, m.referenceCoverage)
            : point(
                m.change,
                m.warnings.length === 0
                  ? { partialDays: 0, missingDays: 0 }
                  : null,
              );
      });
    series = [
      {
        label:
          request.measure === "CHANGE"
            ? `Écart · référence ${query.referencePeriod!.start} au ${query.referencePeriod!.end}`
            : "Période étudiée",
        period: query.currentPeriod,
        points: values(request.measure === "CHANGE" ? "CHANGE" : "CURRENT"),
      },
    ];
    if (request.measure === "CURRENT_REFERENCE")
      series.push({
        label: "Référence",
        period: query.referencePeriod!,
        points: values("REFERENCE"),
      });
  } else {
    const days = explorerDays(query.currentPeriod);
    if (
      query.referencePeriod &&
      request.measure === "CURRENT_REFERENCE" &&
      explorerDays(query.referencePeriod).length !== days.length
    )
      return undefined;
    const daily = (period: typeof query.currentPeriod) => {
      const rows: Result["rows"] = [];
      for (const offset of [0, 20]) {
        const page = executeAnalyticsQuery({
          ...input,
          points: input.points.filter(
            (p) =>
              p.businessDate >= period.start && p.businessDate <= period.end,
          ),
          query: {
            ...query,
            chart: undefined,
            currentPeriod: period,
            referencePeriod: null,
            groupBy: "DAY",
            includeSalesMeasures: false,
            includeSalesConcentration: false,
            having: null,
            sort: { metric, value: "GROUP", direction: "ASC" },
            offset,
            limit: 20,
          },
        });
        rows.push(...page.rows);
        if (!page.hasMore) break;
      }
      return new Map(
        rows.map((r) => [r.key, r.metrics.find((m) => m.metric === metric)!]),
      );
    };
    const current = daily(query.currentPeriod);
    labels = days;
    series = [
      {
        label: "Période étudiée",
        period: query.currentPeriod,
        points: days.map((d) => {
          const m = current.get(d);
          return point(m?.current ?? null, m?.currentCoverage ?? null);
        }),
      },
    ];
    if (request.measure === "CURRENT_REFERENCE") {
      const reference = daily(query.referencePeriod!);
      series.push({
        label: "Référence",
        period: query.referencePeriod!,
        points: days.map((d, i) => {
          const date =
            query.referenceMode === "ISO_YEAR"
              ? previousIsoYearDate(d)
              : addExplorerDays(query.referencePeriod!.start, i);
          const m = date ? reference.get(date) : undefined;
          return point(m?.current ?? null, m?.currentCoverage ?? null);
        }),
      });
    }
  }
  return copilotChartSchema.parse({
    version: 1,
    type: request.type,
    title:
      titles[metric] +
      (query.aggregation === "AVERAGE" ? " · moyenne par jour renseigné" : ""),
    unit: "EUR",
    labels,
    series,
  });
}
