import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  explorerLabel,
  explorerMonthWeeks,
  explorerRange,
  explorerPeriodFromDate,
  explorerChartBuckets,
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
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: selected ? colors.forest : colors.surfaceMuted,
        justifyContent: "center",
        flexGrow: 1,
      }}
    >
      <Text
        style={{
          color: selected ? colors.onAccent : colors.ink,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function ExplorerContent({
  view,
  data,
  syncStatus,
  loadingError = false,
  onMetric,
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
  onGranularity: (k: AnalyticsExplorerGranularity) => void;
  onShift: (n: number) => void;
  onPick: () => void;
  onDrill: (date: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onWeek: (period: ExplorerPeriod) => void;
  onChartScroll: (offset: number) => void;
}) {
  const chart = useRef<ScrollView>(null);
  const chartReady = !!data;
  useEffect(() => {
    if (chartReady)
      requestAnimationFrame(() =>
        chart.current?.scrollTo({ x: view.frame.chartScroll, animated: false }),
      );
  }, [view.frame.period, view.frame.chartScroll, chartReady]);
  const period = view.frame.period,
    range = explorerRange(period),
    c = data?.comparison;
  const percent = c?.percentageDifference ?? null,
    sign = percent ? parseDecimal(percent).value.comparedTo(0) : 0,
    color =
      sign === 0
        ? colors.muted
        : (["waste", "wasteCost"].includes(view.metric) ? sign < 0 : sign > 0)
          ? colors.positive
          : colors.critical;
  const bins = data ? explorerChartBuckets(period, data.points) : [],
    max = bins.reduce((n, b) => {
      if (b.value === null) return n;
      const v = parseDecimal(b.value).value.abs();
      return v.greaterThan(n) ? v : n;
    }, parseDecimal("0").value);
  return (
    <>
      {view.metric === "wasteCost" ? (
        <Text className="text-sm leading-5 text-muted">
          Coût d’achat connu et estimé selon les données disponibles, distinct
          de la valeur au prix de vente.
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Object.entries(kinds).map(([k, label]) => (
          <Choice
            key={k}
            label={label}
            selected={period.kind === k}
            onPress={() => onGranularity(k as AnalyticsExplorerGranularity)}
          />
        ))}
      </View>
      {view.history.length ? (
        <SecondaryButton
          label={`Retour à ${explorerLabel(view.history.at(-1)!.period)}`}
          onPress={onBack}
        />
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
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
              fontSize: 19,
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
          <Text style={{ color: colors.forest, fontSize: 12 }}>
            {period.kind === "range"
              ? "Dates et calcul repris de la discussion"
              : "Choisir une période"}
          </Text>
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["sales", "margin", "waste"] as const).map((m) => (
          <Choice
            key={m}
            label={
              m === "sales" ? "CA" : m === "margin" ? "Marge €" : "Casse €"
            }
            selected={view.metric === m}
            onPress={() => onMetric(m)}
          />
        ))}
      </View>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 20,
          padding: 20,
          gap: 12,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Text style={{ color: colors.muted }}>{metrics[view.metric]}</Text>
        {data ? (
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
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
            <Text style={{ color: colors.muted }}>
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
                    : " clos comparable"}
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
                  : explorerLabel(data.reference)}
                {period.kind === "range"
                  ? " · aucun alignement ISO supposé"
                  : period.kind === "month" || period.kind === "year"
                    ? " · calendrier civil, sans alignement des jours de semaine"
                    : " · mêmes jours de semaine"}
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
                {formatFrenchCalendarDate(data.referenceRange.start)} –{" "}
                {formatFrenchCalendarDate(data.referenceRange.end)}
              </Text>
            ) : null}
          </>
        )}
      </View>
      {data && period.kind !== "day" ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>
            {period.kind === "year" ||
            (period.kind === "range" && bins[0]?.monthly)
              ? "Détail par mois"
              : "Détail par jour"}
          </Text>
          <Text style={{ color: colors.muted }}>
            Touchez une colonne pour ouvrir le détail. Les montants partiels
            restent signalés.
          </Text>
          <ScrollView
            ref={chart}
            onScroll={(e) =>
              onChartScroll(Math.max(0, e.nativeEvent.contentOffset.x))
            }
            scrollEventThrottle={120}
            horizontal
            contentContainerStyle={{
              gap: 8,
              alignItems: "flex-end",
              paddingVertical: 8,
            }}
          >
            {bins.map((b) => {
              const negative =
                  b.value !== null && parseDecimal(b.value).value.isNegative(),
                height =
                  b.value === null
                    ? 0
                    : max.isZero()
                      ? 2
                      : Math.max(
                          2,
                          Math.min(
                            100,
                            parseDecimal(b.value)
                              .value.abs()
                              .div(max)
                              .toNumber() * 100,
                          ),
                        ),
                label = b.monthly
                  ? new Intl.DateTimeFormat("fr-FR", {
                      month: "short",
                      ...(period.kind === "range"
                        ? { year: "numeric" as const }
                        : {}),
                      timeZone: "UTC",
                    }).format(new Date(b.date + "T12:00:00Z"))
                  : b.date.slice(8);
              return (
                <Pressable
                  key={b.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatFrenchCalendarDate(b.date)} : ${b.value === null ? "sans donnée" : formatCurrency(b.value)}${b.complete ? "" : " · données incomplètes"}. Ouvrir le détail.`}
                  onPress={() => onDrill(b.date)}
                  style={{
                    minWidth: 52,
                    minHeight: 170,
                    padding: 4,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {b.value === null ? "—" : formatCurrency(b.value)}
                  </Text>
                  <View
                    style={{
                      height: 104,
                      width: 30,
                      justifyContent: "flex-end",
                      borderBottomWidth: 1,
                      borderColor: colors.line,
                    }}
                  >
                    {b.value !== null ? (
                      <View
                        style={{
                          height,
                          width: 30,
                          borderRadius: 5,
                          backgroundColor: negative
                            ? colors.critical
                            : colors.forest,
                          opacity: b.complete ? 1 : 0.5,
                        }}
                      />
                    ) : (
                      <View
                        style={{
                          height: 20,
                          borderWidth: 1,
                          borderStyle: "dashed",
                          borderColor: colors.muted,
                          borderRadius: 4,
                        }}
                      />
                    )}
                  </View>
                  <Text style={{ color: colors.ink }}>{label}</Text>
                  {!b.complete ? (
                    <Text style={{ fontSize: 10, color: colors.warning }}>
                      {b.value === null ? "Sans donnée" : "Partiel"}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      {data?.total === null ? (
        <InlineAlert
          title="Aucun montant disponible"
          message="Cette période ne contient pas encore de données locales pour cet indicateur. Changez de période ou ajoutez les sources depuis le copilote."
        />
      ) : null}
      {period.kind === "month" ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
            Semaines de ce mois
          </Text>
          {explorerMonthWeeks(period).map((week) => (
            <SecondaryButton
              key={JSON.stringify(week)}
              label={`${explorerLabel(week)} · ${formatFrenchCalendarDate(explorerRange(week).start)} – ${formatFrenchCalendarDate(explorerRange(week).end)}`}
              onPress={() => onWeek(week)}
            />
          ))}
        </View>
      ) : null}
      <StatusBadge status={syncStatus} />
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
