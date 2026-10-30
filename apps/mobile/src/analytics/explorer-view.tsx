import { ExplorerTrendChart } from "./explorer-trend-chart";
import { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import {
  explorerLabel,
  explorerMonthWeeks,
  explorerRange,
  explorerDays,
  explorerPeriodFromDate,
  explorerHasFilters,
  parseDecimal,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import type {
  AnalyticsExplorerMetric,
  AnalyticsExplorerGranularity,
} from "@fl-copilot/domain";
import {
  BottomSheet,
  InlineAlert,
  SecondaryButton,
  StatusBadge,
  type SyncStatus,
} from "../components/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DetailsDisclosure, SegmentedControl } from "../components/dashboard";
import { DateSelector } from "../components/date-selector";
import { explorerScopeLabel } from "./explorer-breakdown";
import { colors } from "../design/tokens";
import { formatFrenchCalendarDate } from "../dates/calendar";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercentage,
} from "../today/today-priority-presentation";
import type { ExplorerView } from "./explorer-state";
import type { ExplorerRepository } from "./explorer-repository";
type Data = Awaited<ReturnType<ExplorerRepository["load"]>>;
const kinds = {
  day: "Jour",
  week: "Semaine",
  month: "Mois",
  year: "Année",
} as const;
const metrics = {
  sales: "Chiffre d’affaires net",
  margin: "Marge en euros",
  waste: "Casse au prix de vente",
  wasteCost: "Casse au prix d’achat",
} as const;
export function ExplorerContent({
  view,
  data,
  syncStatus,
  loadingError = false,
  onMetric,
  onFilters,
  onClearFilters,
  onGranularity,
  onShift,
  onPick,
  onDrill,
  onBack,
  onRefresh,
  onWeek,
  onChartScroll,
}: {
  view: ExplorerView;
  data?: Data;
  syncStatus: SyncStatus;
  loadingError?: boolean;
  onMetric: (m: AnalyticsExplorerMetric) => void;
  onFilters: () => void;
  onClearFilters: () => void;
  onGranularity: (k: AnalyticsExplorerGranularity) => void;
  onShift: (n: number) => void;
  onPick: () => void;
  onDrill: (date: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onWeek: (period: ExplorerPeriod) => void;
  onChartScroll: (offset: number) => void;
}) {
  const period = view.frame.period,
    range = explorerRange(period),
    c = data?.comparison,
    filtered = explorerHasFilters(view.frame.filters),
    allScope =
      period.kind === "range" && period.basis === "OBSERVED_PRODUCTS"
        ? "Tous les produits"
        : "Tout le rayon";
  const percent = c?.percentageDifference ?? null,
    sign = percent ? parseDecimal(percent).value.comparedTo(0) : 0,
    color =
      sign === 0
        ? colors.muted
        : (["waste", "wasteCost"].includes(view.metric) ? sign < 0 : sign > 0)
          ? colors.positive
          : colors.critical;
  return (
    <>
      <SegmentedControl
        label="Période"
        value={period.kind}
        options={Object.entries(kinds).map(([value, label]) => ({
          value: value as AnalyticsExplorerGranularity,
          label,
        }))}
        onChange={onGranularity}
      />
      {view.history.length ? (
        <SecondaryButton
          label={
            JSON.stringify(view.history.at(-1)!.period) ===
            JSON.stringify(period)
              ? "Retour à l’analyse précédente"
              : `Retour à ${explorerLabel(view.history.at(-1)!.period)}`
          }
          onPress={onBack}
        />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          gap: 4,
          alignItems: "center",
          backgroundColor: colors.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Période précédente"
          disabled={period.kind === "range"}
          accessibilityState={{ disabled: period.kind === "range" }}
          onPress={() => onShift(-1)}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 26, color: colors.forest }}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choisir la période : ${explorerLabel(period)}`}
          disabled={period.kind === "range"}
          onPress={onPick}
          style={{
            flex: 1,
            minHeight: 56,
            justifyContent: "center",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text
            style={{
              color: colors.ink,
              fontSize: 16,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {explorerLabel(period)}
          </Text>
          {period.kind !== "day" ? (
            <Text style={{ color: colors.muted, textAlign: "center" }}>
              {formatFrenchCalendarDate(range.start)} –{" "}
              {formatFrenchCalendarDate(range.end)}
            </Text>
          ) : null}
          {period.kind === "range" ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Période de la discussion
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Période suivante"
          disabled={period.kind === "range"}
          accessibilityState={{ disabled: period.kind === "range" }}
          onPress={() => onShift(1)}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 26, color: colors.forest }}>›</Text>
        </Pressable>
      </View>
      {filtered ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: 10,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.forest,
            backgroundColor: colors.forestSoft,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Modifier les filtres actifs"
            onPress={onFilters}
            style={{
              flex: 1,
              minWidth: 160,
              minHeight: 48,
              justifyContent: "center",
              gap: 4,
            }}
          >
            <Text
              style={{ color: colors.forest, fontSize: 12, fontWeight: "600" }}
            >
              Filtres actifs
            </Text>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>
              {explorerScopeLabel({
                filters: view.frame.filters,
                details: data?.details,
              })}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Afficher ${allScope.toLowerCase()} pour cette période`}
            onPress={onClearFilters}
            style={({ pressed }) => ({
              minHeight: 48,
              paddingHorizontal: 12,
              justifyContent: "center",
              borderRadius: 10,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.forest, fontWeight: "600" }}>
              {allScope}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <SegmentedControl
        label="Indicateur"
        value={view.metric}
        options={[
          { value: "sales" as const, label: "CA" },
          { value: "margin" as const, label: "Marge €" },
          { value: "waste" as const, label: "Casse PV" },
          { value: "wasteCost" as const, label: "Casse PA" },
        ]}
        onChange={onMetric}
      />
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 20,
          padding: 14,
          gap: 12,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Text style={{ color: colors.muted }}>{metrics[view.metric]}</Text>
        {data && !filtered ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {explorerScopeLabel(data)}
          </Text>
        ) : null}
        {!data ? (
          <Text style={{ color: colors.muted }}>
            {loadingError
              ? "Les chiffres ne sont pas disponibles pour le moment."
              : "Lecture des chiffres locaux…"}
          </Text>
        ) : (
          <>
            <Text
              accessibilityRole="header"
              style={{ color: colors.ink, fontSize: 30, fontWeight: "700" }}
            >
              {data.total === null
                ? "Indisponible"
                : formatCurrency(data.total)}
            </Text>
            <Text
              style={{
                color:
                  data.coverage.partial || data.coverage.missing
                    ? colors.warning
                    : colors.muted,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {period.kind === "range" && period.aggregation === "AVERAGE"
                ? "Moyenne des jours renseignés"
                : "Cumul renseigné"}{" "}
              · {data.coverage.complete}/{data.coverage.expected} journées
              complètes
              {data.coverage.partial
                ? ` · ${data.coverage.partial} partielles`
                : ""}
              {data.coverage.missing
                ? ` · ${data.coverage.missing} sans donnée`
                : ""}
            </Text>
            {c ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: 8,
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                  }}
                >
                  <Text style={{ color, fontWeight: "700", fontSize: 13 }}>
                    {c.status === "PARTIAL" ? "Indicatif · " : ""}
                    {percent !== null
                      ? formatSignedPercentage(percent)
                      : c.absoluteDifference !== null
                        ? formatSignedCurrency(c.absoluteDifference)
                        : "Écart indisponible"}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Sur {data.comparedDays} jours{" "}
                  {data.mode === "EXPLICIT"
                    ? "de la période citée"
                    : "clos renseignés équivalents · N−1"}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {formatCurrency(c.currentValue)} contre{" "}
                  {formatCurrency(c.referenceValue)} en référence
                </Text>
                {c.status === "PARTIAL" ? (
                  <Text style={{ color: colors.warning, fontSize: 12 }}>
                    Données partielles : l’écart porte uniquement sur les jours
                    équivalents renseignés des deux côtés, pas nécessairement
                    sur tout le cumul affiché.
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={{ color: colors.warning, fontSize: 12 }}>
                {data.reference === null
                  ? "Aucune période équivalente disponible en N−1"
                  : "Pas de journée close renseignée des deux côtés pour comparer"}
              </Text>
            )}
          </>
        )}
        {data &&
        period.kind !== "day" &&
        data.points.some((point) => point.value !== null) ? (
          <View style={{ gap: 12 }}>
            <Text
              style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}
            >
              {period.kind === "year" ||
              (period.kind === "range" &&
                explorerDays(explorerRange(period)).length > 62)
                ? "Détail par mois"
                : "Détail par jour"}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Touchez une colonne pour explorer · €
            </Text>
            <ExplorerTrendChart
              period={period}
              points={data.points}
              scrollOffset={view.frame.chartScroll}
              onChartScroll={onChartScroll}
              onDrill={onDrill}
            />
          </View>
        ) : null}
        {data ? (
          <DetailsDisclosure title="Couverture et comparaison">
            {c ? (
              <View
                style={{
                  gap: 6,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                  paddingTop: 12,
                }}
              >
                <Text style={{ color: colors.ink, fontWeight: "600" }}>
                  {data.mode === "EXPLICIT"
                    ? "Comparaison explicite · "
                    : "Comparaison de "}
                  {data.comparedDays} jour
                  {data.comparedDays > 1 ? "s" : ""}
                  {data.mode === "EXPLICIT"
                    ? " sur la période citée"
                    : " clos renseigné équivalent"}
                  {data.mode !== "EXPLICIT" && data.comparedDays > 1 ? "s" : ""}
                </Text>
                <Text style={{ color: colors.ink }}>
                  {formatCurrency(c.currentValue)} contre{" "}
                  {formatCurrency(c.referenceValue)}
                </Text>
                <Text style={{ color, fontWeight: "700" }}>
                  {c.absoluteDifference === null
                    ? "Écart indisponible"
                    : formatSignedCurrency(c.absoluteDifference)}
                  {percent !== null
                    ? ` · ${formatSignedPercentage(percent)}`
                    : " · pourcentage indisponible (référence nulle)"}
                </Text>
              </View>
            ) : (
              <Text style={{ color: colors.warning }}>
                {data.reference === null
                  ? data.mode === "EXPLICIT"
                    ? "Aucune période de référence demandée pour cette source."
                    : "Aucune période équivalente disponible en N−1."
                  : data.mode === "EXPLICIT"
                    ? "La couverture, la durée ou les dates ne permettent pas d’afficher un écart comparable."
                    : "La couverture ne permet pas encore une comparaison fiable des jours clos."}
              </Text>
            )}
            {data.reference ? (
              <Text style={{ color: colors.muted }}>
                Référence :{" "}
                {data.mode === "EXPLICIT"
                  ? "période explicitement demandée"
                  : "jours équivalents N−1"}
                {period.kind === "range"
                  ? " · aucun alignement ISO supposé"
                  : " · mêmes semaines ISO et mêmes jours de semaine"}
              </Text>
            ) : null}
            {data.mode === "EXPLICIT" ? (
              <Text style={{ color: colors.muted }}>
                Données locales actuelles ; la valeur citée reste conservée dans
                la discussion.{" "}
                {period.kind === "range" && period.aggregation === "AVERAGE"
                  ? "Moyenne journalière, pas un cumul."
                  : "Somme des montants renseignés."}{" "}
                {data.warnings.includes("DIFFERENT_PERIOD_LENGTHS")
                  ? "Les périodes n’ont pas la même durée."
                  : ""}
              </Text>
            ) : null}
            {data.referenceRange ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {formatFrenchCalendarDate(
                  c?.referencePeriod?.start ?? data.referenceRange.start,
                )}{" "}
                –{" "}
                {formatFrenchCalendarDate(
                  c?.referencePeriod?.end ?? data.referenceRange.end,
                )}
              </Text>
            ) : null}
            {data.warnings.includes("NO_ISO_EQUIVALENT") ? (
              <Text style={{ color: colors.warning }}>
                Certaines journées n’ont pas d’équivalent de même semaine ISO en
                N−1. Elles ne sont pas incluses dans l’écart.
              </Text>
            ) : null}
            {view.metric === "wasteCost" ? (
              <Text style={{ color: colors.muted }}>
                Coût d’achat connu et estimé selon les données disponibles,
                distinct de la valeur au prix de vente.
              </Text>
            ) : null}
            {view.metric === "waste" || view.metric === "wasteCost" ? (
              <Text style={{ color: colors.muted }}>
                Casse enregistrée sur la période. Les dates Mercalys peuvent
                correspondre au déchargement de l’appareil plutôt qu’au jour du
                bipage. Une journée sans enregistrement ne signifie pas une
                journée sans casse.
              </Text>
            ) : null}
          </DetailsDisclosure>
        ) : null}
      </View>
      {data?.total === null ? (
        <InlineAlert
          title="Aucun montant disponible"
          message={
            filtered
              ? `Aucun montant n’est renseigné pour cette sélection. Touchez « ${allScope} » pour élargir la recherche, ou choisissez une autre période.`
              : "Cette période ne contient pas encore de données locales pour cet indicateur. Changez de période ou ajoutez les sources depuis le copilote."
          }
        />
      ) : null}
      {period.kind === "month" ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
            Semaines de ce mois
          </Text>
          {explorerMonthWeeks(period).map((week) => (
            <Pressable
              key={JSON.stringify(week)}
              accessibilityRole="button"
              accessibilityLabel={`Explorer ${explorerLabel(week)}`}
              onPress={() => onWeek(week)}
              style={{
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderBottomWidth: 1,
                borderColor: colors.line,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>
                  {explorerLabel(week)}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {formatFrenchCalendarDate(explorerRange(week).start)} –{" "}
                  {formatFrenchCalendarDate(explorerRange(week).end)}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.muted}
                accessible={false}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      <StatusBadge status={syncStatus} compact />
      <SecondaryButton
        label="Actualiser les chiffres locaux"
        onPress={onRefresh}
      />
    </>
  );
}
export function ExplorerPeriodPicker({
  visible,
  period,
  onClose,
  onSelect,
}: {
  visible: boolean;
  period: ExplorerPeriod;
  onClose: () => void;
  onSelect: (p: ExplorerPeriod) => void;
}) {
  const [year, setYear] = useState(
    Number(explorerRange(period).start.slice(0, 4)),
  );
  useEffect(() => {
    if (visible)
      setYear(
        period.kind === "week"
          ? period.year
          : Number(explorerRange(period).start.slice(0, 4)),
      );
  }, [visible, period]);
  const options =
    period.kind === "week"
      ? Array.from({ length: 53 }, (_, i) => ({
          kind: "week" as const,
          year,
          week: i + 1,
        })).filter((p) => {
          try {
            explorerRange(p);
            return true;
          } catch {
            return false;
          }
        })
      : period.kind === "month"
        ? Array.from({ length: 12 }, (_, i) => ({
            kind: "month" as const,
            year,
            month: i + 1,
          }))
        : Array.from({ length: 20 }, (_, i) => ({
            kind: "year" as const,
            year: Math.max(1900, Math.min(2180, year - 10)) + i,
          }));
  return (
    <BottomSheet
      visible={visible}
      title="Choisir la période"
      swipeToClose
      onClose={onClose}
    >
      {period.kind === "range" ? (
        <Text style={{ color: colors.ink }}>
          Cette période reprend les dates et le calcul de la source. Utilisez
          Jour, Semaine, Mois ou Année pour revenir à l’exploration habituelle.
        </Text>
      ) : period.kind === "day" ? (
        <DateSelector
          label="Journée analysée"
          description="Choisissez la journée à consulter."
          value={period.date}
          onConfirm={(date) => onSelect(explorerPeriodFromDate("day", date))}
        />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <SecondaryButton
              label="Année −"
              disabled={year <= 1900}
              onPress={() =>
                setYear((y) =>
                  Math.max(1900, y - (period.kind === "year" ? 20 : 1)),
                )
              }
            />
            <Text style={{ color: colors.ink, alignSelf: "center" }}>
              {year}
            </Text>
            <SecondaryButton
              label="Année +"
              disabled={year >= 2199}
              onPress={() =>
                setYear((y) =>
                  Math.min(2199, y + (period.kind === "year" ? 20 : 1)),
                )
              }
            />
          </View>
          <View
            style={{
              gap: 8,
              flexDirection: period.kind === "week" ? "column" : "row",
              flexWrap: "wrap",
            }}
          >
            {options.map((p) => (
              <Pressable
                key={JSON.stringify(p)}
                accessibilityRole="button"
                accessibilityLabel={explorerLabel(p)}
                onPress={() => onSelect(p)}
                style={{
                  minHeight: 48,
                  width: period.kind === "week" ? "100%" : "48%",
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: colors.surfaceMuted,
                  gap: 4,
                }}
              >
                <Text style={{ color: colors.ink, fontWeight: "600" }}>
                  {explorerLabel(p)}
                </Text>
                {p.kind === "week" ? (
                  <Text style={{ color: colors.muted }}>
                    {formatFrenchCalendarDate(explorerRange(p).start)} –{" "}
                    {formatFrenchCalendarDate(explorerRange(p).end)}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </BottomSheet>
  );
}
