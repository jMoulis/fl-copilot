import { useState } from "react";
import { Text, View, Pressable } from "react-native";
import {
  explorerLabel,
  explorerRange,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import type { AnalyticsExplorerMetric } from "@fl-copilot/domain";
import { IconButton, SegmentedControl } from "../components/dashboard";
import { BottomSheet, InlineAlert, SecondaryButton } from "../components/ui";
import { ExplorerTrendChart } from "../analytics/explorer-trend-chart";
import type { ExplorerRepository } from "../analytics/explorer-repository";
import {
  drillExplorerView,
  type ExplorerView,
} from "../analytics/explorer-state";
import { colors } from "../design/tokens";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercentage,
} from "../today/today-priority-presentation";
import { formatFrenchCalendarDate } from "../dates/calendar";
import {
  productMetricDetail,
  productCoverageLabel,
} from "./product-performance-presentation";

export type ProductPerformanceData = Partial<
  Record<
    AnalyticsExplorerMetric,
    Awaited<ReturnType<ExplorerRepository["load"]>>
  >
>;
const labels = {
  sales: "CA TTC",
  margin: "Marge",
  waste: "Casse PV",
  wasteCost: "Casse PA",
} as const;
const titles = {
  sales: "Chiffre d’affaires TTC",
  margin: "Marge en euros",
  waste: "Casse au prix de vente",
  wasteCost: "Casse au prix d’achat",
} as const;

/** Display canonical local amounts only; the Explorer owns comparison and coverage. */
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
  const [details, setDetails] = useState(false);
  const result = data?.[view.metric],
    range = explorerRange(view.frame.period),
    comparison = result?.comparison;
  const difference =
    comparison?.percentageDifference != null
      ? formatSignedPercentage(comparison.percentageDifference)
      : comparison?.absoluteDifference != null
        ? formatSignedCurrency(comparison.absoluteDifference)
        : null;
  const positive = comparison
    ? ["waste", "wasteCost"].includes(view.metric)
      ? comparison.absoluteDifference !== null &&
        Number(comparison.absoluteDifference) <= 0
      : comparison.absoluteDifference !== null &&
        Number(comparison.absoluteDifference) >= 0
    : true;
  const summaries = (["sales", "margin", "waste"] as const).filter(
    (metric) => metric !== view.metric,
  );
  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderTopWidth: 1,
          borderColor: colors.line,
          paddingTop: 12,
        }}
      >
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
            gap: 4,
          }}
        >
          <Text
            style={{
              color: colors.ink,
              fontSize: 15,
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
          borderRadius: 25,
          backgroundColor: colors.surface,
          padding: 18,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={{ flex: 1, minWidth: 0, color: colors.muted, fontSize: 14 }}
          >
            {titles[view.metric]}
          </Text>
          <IconButton
            label="Comprendre les chiffres du produit"
            icon="information-circle-outline"
            onPress={() => setDetails(true)}
          />
        </View>
        <Text
          accessibilityLiveRegion="polite"
          adjustsFontSizeToFit
          minimumFontScale={0.65}
          numberOfLines={1}
          style={{
            color: colors.ink,
            fontSize: result?.total === null ? 28 : 36,
            fontWeight: "700",
            letterSpacing: -1.1,
            fontVariant: ["tabular-nums"],
          }}
        >
          {!result
            ? "…"
            : result.total === null
              ? "Indisponible"
              : formatCurrency(result.total)}
        </Text>
        {result &&
        result.total !== null &&
        (result.coverage.partial || result.coverage.missing) ? (
          <Text style={{ color: colors.warning, fontSize: 12 }}>
            {view.frame.period.kind === "range" &&
            view.frame.period.aggregation === "AVERAGE"
              ? "Moyenne partielle"
              : "Cumul partiel"}
          </Text>
        ) : null}
        {difference !== null ? (
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 8,
              backgroundColor: positive
                ? colors.positiveSoft
                : colors.criticalSoft,
              paddingHorizontal: 9,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: positive ? colors.positive : colors.critical,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {result?.comparisonStatus === "partial" ? "Indicatif · " : ""}
              {difference}
            </Text>
          </View>
        ) : result ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Comparaison indisponible
          </Text>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Lecture des chiffres locaux…
          </Text>
        )}
        {view.frame.period.kind === "range" &&
        view.frame.period.aggregation === "AVERAGE" ? (
          <Text style={{ color: colors.warning, fontSize: 12 }}>
            Moyenne journalière, pas un cumul.
          </Text>
        ) : null}
        {result && view.frame.period.kind !== "day" ? (
          <>
            <ExplorerTrendChart
              period={view.frame.period}
              points={result.points}
              scrollOffset={view.frame.chartScroll}
              onChartScroll={onScroll}
              onDrill={(date) =>
                onExplore(drillExplorerView(view, date).frame.period)
              }
            />
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Touchez une colonne pour explorer · €
            </Text>
          </>
        ) : null}
        {result?.total === null ? (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
            Aucun montant disponible sur cette période. Cela ne signifie pas
            zéro vente ou zéro casse.
          </Text>
        ) : null}
        {view.metric === "wasteCost" ? (
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
            Les coûts disponibles peuvent inclure des estimations. Consultez
            leur détail dans Analyses.
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 14,
          paddingVertical: 8,
        }}
      >
        {summaries.map((metric) => {
          const value = data?.[metric];
          const partial = Boolean(
            value && (value.coverage.partial || value.coverage.missing),
          );
          return (
            <Pressable
              key={metric}
              accessibilityRole="button"
              accessibilityLabel={`${labels[metric]} : ${value?.total == null ? "indisponible" : formatCurrency(value.total)}. Afficher le graphique.`}
              accessibilityHint={productMetricDetail(value, view.frame.period)}
              onPress={() => onMetric(metric)}
              style={{
                flex: 1,
                minWidth: 115,
                minHeight: 70,
                gap: 7,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {labels[metric]}
              </Text>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                numberOfLines={1}
                style={{
                  color: colors.ink,
                  fontSize: value?.total === null ? 18 : 24,
                  fontWeight: "600",
                  letterSpacing: -0.6,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {!value
                  ? "…"
                  : value.total === null
                    ? "Indisponible"
                    : formatCurrency(value.total)}
              </Text>
              {partial && value?.total !== null ? (
                <Text style={{ color: colors.warning, fontSize: 12 }}>
                  Partiel
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <SecondaryButton
        label="Ouvrir dans Analyses"
        onPress={() => onExplore()}
      />
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
      <BottomSheet
        visible={details}
        title="Comprendre les chiffres"
        onClose={() => setDetails(false)}
        swipeToClose
      >
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600" }}>
          {titles[view.metric]}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {productMetricDetail(result, view.frame.period)}
        </Text>
        {result ? (
          <Text style={{ color: colors.muted, lineHeight: 22 }}>
            {productCoverageLabel(result.coverage)}
          </Text>
        ) : null}
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          Les jours sans donnée ne valent pas zéro. La catégorie actuelle du
          produit ne modifie pas ses chiffres historiques.
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {result?.reference
            ? `Référence : ${explorerLabel(result.reference)}${result.mode === "EXPLICIT" ? " · période explicitement demandée" : view.frame.period.kind === "month" || view.frame.period.kind === "year" ? " · calendrier civil, sans alignement des jours de semaine" : " · mêmes jours de semaine en N−1"}`
            : "Aucune référence comparable disponible."}
        </Text>
        {comparison ? (
          <Text style={{ color: colors.ink, lineHeight: 22 }}>
            {formatCurrency(comparison.currentValue)} contre{" "}
            {formatCurrency(comparison.referenceValue)} sur{" "}
            {result!.comparedDays} jour(s){" "}
            {result!.mode === "EXPLICIT"
              ? "de la période citée"
              : "clos comparables"}
            .
          </Text>
        ) : (
          <Text style={{ color: colors.warning, lineHeight: 22 }}>
            La couverture ne permet pas de conclure à une évolution comparable.
          </Text>
        )}
        <SecondaryButton
          label="Fermer les explications"
          onPress={() => setDetails(false)}
        />
      </BottomSheet>
    </View>
  );
}
