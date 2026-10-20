import {
  productMetricDetail,
  productCoverageLabel,
} from "./product-performance-presentation";
import { drillExplorerView } from "../analytics/explorer-state";
import { Text, View, Pressable } from "react-native";
import {
  explorerLabel,
  explorerRange,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import type { AnalyticsExplorerMetric } from "@fl-copilot/domain";
import {
  DashboardMetric,
  DetailsDisclosure,
  IconButton,
  SegmentedControl,
} from "../components/dashboard";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { ExplorerTrendChart } from "../analytics/explorer-trend-chart";
import type { ExplorerRepository } from "../analytics/explorer-repository";
import type { ExplorerView } from "../analytics/explorer-state";
import { colors } from "../design/tokens";
import { formatCurrency } from "../today/today-priority-presentation";
import { formatFrenchCalendarDate } from "../dates/calendar";
export type ProductPerformanceData = Partial<
  Record<
    AnalyticsExplorerMetric,
    Awaited<ReturnType<ExplorerRepository["load"]>>
  >
>;
const labels = {
  sales: "CA net",
  margin: "Marge",
  waste: "Casse PV",
  wasteCost: "Casse PA",
} as const;
export function ProductPerformanceView({
  view,
  data,
  error,
  notice,
  updating = false,
  onMetric,
  onShift,
  onExplore,
  onScroll,
  onRefresh,
}: {
  view: ExplorerView;
  data?: ProductPerformanceData;
  error?: string;
  notice?: string;
  updating?: boolean;
  onMetric(metric: AnalyticsExplorerMetric): void;
  onShift(amount: number): void;
  onExplore(period?: ExplorerPeriod, metric?: AnalyticsExplorerMetric): void;
  onScroll(offset: number): void;
  onRefresh(): void;
}) {
  const result = data?.[view.metric],
    range = explorerRange(view.frame.period);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton
          label="Période précédente"
          icon="chevron-back"
          disabled={view.frame.period.kind === "range"}
          onPress={() => onShift(-1)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choisir la période dans Analyses. ${explorerLabel(view.frame.period)}`}
          onPress={() => onExplore()}
          style={{
            flex: 1,
            minHeight: 48,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: colors.ink,
              fontWeight: "600",
              textAlign: "center",
            }}
          >
            {explorerLabel(view.frame.period)}
          </Text>
          <Text
            style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}
          >
            {formatFrenchCalendarDate(range.start)} –{" "}
            {formatFrenchCalendarDate(range.end)}
          </Text>
        </Pressable>
        <IconButton
          label="Période suivante"
          icon="chevron-forward"
          disabled={view.frame.period.kind === "range"}
          onPress={() => onShift(1)}
        />
      </View>
      {updating ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.muted, fontSize: 12 }}
        >
          Actualisation des chiffres locaux…
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {(["sales", "margin"] as const).map((metric) => {
          const value = data?.[metric];
          return (
            <Pressable
              key={metric}
              accessibilityRole="button"
              accessibilityLabel={`${labels[metric]} : ${value?.total == null ? "indisponible" : formatCurrency(value.total)}. Afficher le graphique.`}
              onPress={() => onMetric(metric)}
              style={{ flex: 1, minWidth: 125 }}
            >
              <DashboardMetric
                compact
                label={
                  metric === "sales"
                    ? "Chiffre d’affaires net"
                    : "Marge en euros"
                }
                icon={
                  metric === "sales" ? "wallet-outline" : "trending-up-outline"
                }
                value={
                  !value
                    ? "…"
                    : value.total == null
                      ? null
                      : formatCurrency(value.total)
                }
                detail={productMetricDetail(value, view.frame.period)}
              />
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Écarts calculés sur les jours clos comparables uniquement.
      </Text>
      <SegmentedControl
        label="Chiffres du produit"
        value={view.metric}
        options={Object.entries(labels).map(([value, label]) => ({
          value: value as AnalyticsExplorerMetric,
          label,
        }))}
        onChange={onMetric}
      />
      <View
        style={{
          gap: 12,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
          padding: 14,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text
            accessibilityRole="header"
            style={{ color: colors.ink, fontSize: 18, fontWeight: "600" }}
          >
            {view.metric === "sales"
              ? "Ventes nettes"
              : view.metric === "margin"
                ? "Marge en euros"
                : view.metric === "waste"
                  ? "Casse au prix de vente"
                  : "Casse au prix d’achat"}
          </Text>
          {result ? (
            <>
              {["waste", "wasteCost"].includes(view.metric) ? (
                <Text
                  style={{
                    color: colors.ink,
                    fontSize: 26,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {result.total === null
                    ? "Indisponible"
                    : formatCurrency(result.total)}
                </Text>
              ) : null}
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.muted, fontSize: 12 }}
              >
                {productCoverageLabel(result.coverage)}
              </Text>
              {view.frame.period.kind === "range" &&
              view.frame.period.aggregation === "AVERAGE" ? (
                <Text style={{ color: colors.warning, fontSize: 12 }}>
                  Moyenne journalière, pas un cumul.
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={{ color: colors.muted }}>
              Lecture des chiffres locaux…
            </Text>
          )}
        </View>
        {result && view.frame.period.kind !== "day" ? (
          <>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Touchez une colonne pour explorer · €
            </Text>
            <ExplorerTrendChart
              period={view.frame.period}
              points={result.points}
              scrollOffset={view.frame.chartScroll}
              onChartScroll={onScroll}
              onDrill={(date) =>
                onExplore(drillExplorerView(view, date).frame.period)
              }
            />
          </>
        ) : null}
        {result?.total === null ? (
          <Text style={{ color: colors.muted }}>
            Aucun montant disponible pour ce produit sur cette période. Cela ne
            signifie pas zéro vente ou zéro casse.
          </Text>
        ) : null}
        {view.metric === "wasteCost" ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Les coûts disponibles peuvent inclure des estimations. Consultez
            leur détail dans Analyses.
          </Text>
        ) : null}
        <DetailsDisclosure title="Couverture et référence">
          <Text style={{ color: colors.muted }}>
            Les jours sans donnée ne valent pas zéro. La catégorie actuelle du
            produit ne modifie pas ses chiffres historiques.
          </Text>
          <Text style={{ color: colors.muted }}>
            {result?.reference
              ? `Référence : ${explorerLabel(result.reference)}${result.mode === "EXPLICIT" ? " · période explicitement demandée" : view.frame.period.kind === "month" || view.frame.period.kind === "year" ? " · calendrier civil, sans alignement des jours de semaine" : " · mêmes jours de semaine en N−1"}`
              : "Aucune référence comparable disponible."}
          </Text>
          {result?.comparison ? (
            <Text style={{ color: colors.ink }}>
              {formatCurrency(result.comparison.currentValue)} contre{" "}
              {formatCurrency(result.comparison.referenceValue)} sur{" "}
              {result.comparedDays} jour(s){" "}
              {result.mode === "EXPLICIT"
                ? "de la période citée"
                : "clos comparables"}
              .
            </Text>
          ) : (
            <Text style={{ color: colors.warning }}>
              La couverture ne permet pas de conclure à une évolution
              comparable.
            </Text>
          )}
        </DetailsDisclosure>
        <SecondaryButton
          label="Ouvrir dans Analyses"
          onPress={() => onExplore()}
        />
      </View>
      {error ? (
        <InlineAlert title="Lecture interrompue" message={error} />
      ) : null}
      {notice ? (
        <InlineAlert title="Contexte conservé" message={notice} />
      ) : null}
      {error ? (
        <SecondaryButton
          label="Relire les chiffres locaux"
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}
