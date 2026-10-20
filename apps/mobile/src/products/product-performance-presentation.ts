import type { ExplorerPeriod } from "@fl-copilot/analytics-core";
import type { ExplorerRepository } from "../analytics/explorer-repository";
import {
  formatSignedCurrency,
  formatSignedPercentage,
} from "../today/today-priority-presentation";
type Data = Pick<
  Awaited<ReturnType<ExplorerRepository["load"]>>,
  "total" | "comparison" | "coverage" | "mode"
>;
/** Display only: amounts, means and comparison eligibility belong to the shared engine. */
export function productMetricDetail(
  value: Data | undefined,
  period: ExplorerPeriod,
) {
  if (!value) return "Lecture locale…";
  if (value.total === null) return "Sans donnée";
  const partial = !!(value.coverage.partial || value.coverage.missing);
  const basis =
    period.kind === "range" && period.aggregation === "AVERAGE"
      ? partial
        ? "Moyenne partielle"
        : "Moyenne journalière"
      : partial
        ? "Partiel"
        : "Période renseignée";
  const c = value.comparison;
  const delta =
    c?.percentageDifference != null
      ? formatSignedPercentage(c.percentageDifference)
      : c?.absoluteDifference != null
        ? formatSignedCurrency(c.absoluteDifference)
        : null;
  return `${basis} · ${delta === null ? "écart indisponible" : `${delta}${value.mode === "EXPLICIT" ? " vs référence" : " vs N−1"}`}`;
}
export function productCoverageLabel(coverage: Data["coverage"]) {
  return `${coverage.complete} jour${coverage.complete === 1 ? "" : "s"} complet${coverage.complete === 1 ? "" : "s"} · ${coverage.partial} partiel${coverage.partial === 1 ? "" : "s"} · ${coverage.missing} sans donnée`;
}
