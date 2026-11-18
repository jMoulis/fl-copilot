import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  explorerChartBuckets,
  parseDecimal,
  type DatedKpiValue,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import { colors } from "../design/tokens";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { formatCurrency } from "../today/today-priority-presentation";

type Props = {
  period: ExplorerPeriod;
  points: readonly DatedKpiValue[];
  selectedDate?: string;
  onSelect?(date: string): void;
  /** Retained for older persisted views; the overview no longer scrolls horizontally. */
  scrollOffset?: number;
  onChartScroll?(offset: number): void;
  onDrill(date: string): void;
  inverse?: boolean;
};
/** Selection is presentation-only; opening detail is a separate, explicit action. */
export function ExplorerTrendChart(props: Props) {
  return <TrendChart key={JSON.stringify(props.period)} {...props} />;
}
function TrendChart({
  period,
  points,
  selectedDate,
  onSelect,
  onDrill,
  inverse = false,
}: Props) {
  const bins = explorerChartBuckets(period, points);
  const [selection, setSelection] = useState(
    selectedDate ?? bins.find((b) => b.value !== null)?.date,
  );
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    bins.findIndex((b) => b.date === selection),
  );
  const selected = bins[index];
  const ink = inverse ? colors.heroInk : colors.ink;
  const muted = inverse ? colors.heroMuted : colors.muted;
  const active = inverse ? colors.accent : colors.forest;
  const bounds = bins.reduce(
    (range, b) => {
      if (b.value === null) return range;
      const value = parseDecimal(b.value).value;
      if (value.isNegative())
        range.negative = value.abs().greaterThan(range.negative)
          ? value.abs()
          : range.negative;
      else if (value.greaterThan(range.positive)) range.positive = value;
      return range;
    },
    { positive: parseDecimal("0").value, negative: parseDecimal("0").value },
  );
  const span = bounds.positive.add(bounds.negative);
  const axisLabel = (value: string) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value));
  const plotHeight = 152;
  const zero = span.isZero()
    ? plotHeight
    : bounds.positive.div(span).toNumber() * plotHeight;
  function select(i: number) {
    const b = bins[Math.max(0, Math.min(bins.length - 1, i))];
    if (b) {
      setSelection(b.date);
      onSelect?.(b.date);
    }
  }
  const tick = (b: typeof selected) =>
    b.monthly
      ? new Date(`${b.date}T12:00:00Z`).toLocaleDateString("fr-FR", {
          month: "short",
          timeZone: "UTC",
        })
      : b.date.slice(8);
  const label = (b: typeof selected) =>
    b.date === b.end
      ? formatFrenchCalendarDate(b.date)
      : `Du ${formatFrenchCalendarDate(b.date)} au ${formatFrenchCalendarDate(b.end)}`;
  const measure =
    period.kind === "range" && period.aggregation === "AVERAGE"
      ? "Moyenne des jours renseignés"
      : selected?.monthly
        ? "Cumul renseigné"
        : "Montant renseigné";
  const status = (b: typeof selected) =>
    b.value === null
      ? "Sans donnée"
      : b.complete
        ? "Complet"
        : "Données incomplètes";
  if (!selected) return null;
  const tickIndices = [
    ...new Set([
      0,
      Math.round((bins.length - 1) / 4),
      Math.round((bins.length - 1) / 2),
      Math.round(((bins.length - 1) * 3) / 4),
      bins.length - 1,
    ]),
  ];
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: muted, fontSize: 12 }}>
        Montants en € · touche le graphique pour lire une valeur
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View
          style={{
            width: 64,
            height: plotHeight,
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: muted, fontSize: 11 }}>
            {axisLabel(bounds.positive.toFixed(2))}
          </Text>
          {bounds.positive.greaterThan(0) && bounds.negative.greaterThan(0) ? (
            <Text
              style={{
                position: "absolute",
                top: Math.min(plotHeight - 16, Math.max(16, zero - 8)),
                color: muted,
                fontSize: 11,
              }}
            >
              0 €
            </Text>
          ) : null}
          <Text style={{ color: muted, fontSize: 11 }}>
            {axisLabel(bounds.negative.negated().toFixed(2))}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Pressable
            testID="explorer-chart-plot"
            accessibilityRole="adjustable"
            accessibilityLabel={`Graphique. ${label(selected)} : ${selected.value === null ? "sans donnée" : `${measure} ${formatCurrency(selected.value)}`}. ${status(selected)}`}
            accessibilityValue={{ min: 1, max: bins.length, now: index + 1 }}
            accessibilityActions={[
              { name: "increment", label: "Valeur suivante" },
              { name: "decrement", label: "Valeur précédente" },
            ]}
            onAccessibilityAction={(e) =>
              select(
                index + (e.nativeEvent.actionName === "increment" ? 1 : -1),
              )
            }
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            onPress={(e) => {
              if (width > 0)
                select(
                  Math.floor((e.nativeEvent.locationX / width) * bins.length),
                );
            }}
            style={{ height: plotHeight, flexDirection: "row", gap: 2 }}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: Math.min(zero, plotHeight - 1),
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: muted,
                opacity: 0.4,
              }}
            />
            {bins.map((b, i) => {
              const amount =
                b.value === null ? null : parseDecimal(b.value).value;
              const negative = amount?.isNegative() ?? false;
              const height =
                amount === null
                  ? 0
                  : span.isZero()
                    ? 2
                    : Math.max(
                        2,
                        amount.abs().div(span).toNumber() * plotHeight,
                      );
              const top = Math.min(
                plotHeight - height,
                Math.max(0, negative ? zero : zero - height),
              );
              return (
                <View
                  key={b.date}
                  pointerEvents="none"
                  testID={`chart-bin:${b.date}`}
                  style={{ flex: 1, height: plotHeight }}
                >
                  {amount !== null ? (
                    <View
                      testID="chart-mark"
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: 0,
                        right: 0,
                        borderRadius: 2,
                        backgroundColor: negative
                          ? inverse
                            ? colors.heroCritical
                            : colors.critical
                          : active,
                        opacity: i === index ? 1 : b.complete ? 0.6 : 0.3,
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        position: "absolute",
                        top: Math.min(plotHeight - 8, Math.max(0, zero - 4)),
                        left: 0,
                        right: 0,
                        height: 8,
                        borderWidth: 1,
                        borderStyle: "dashed",
                        borderColor: muted,
                      }}
                    />
                  )}
                  {i === index ? (
                    <View
                      style={{
                        position: "absolute",
                        bottom: -6,
                        alignSelf: "center",
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: ink,
                      }}
                    />
                  ) : null}
                </View>
              );
            })}
          </Pressable>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 10,
            }}
          >
            {tickIndices.map((i) => (
              <Text key={i} style={{ color: muted, fontSize: 11 }}>
                {tick(bins[i]!)}
              </Text>
            ))}
          </View>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Valeur précédente"
          disabled={index === 0}
          accessibilityState={{ disabled: index === 0 }}
          onPress={() => select(index - 1)}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: index === 0 ? 0.35 : 1,
          }}
        >
          <Text style={{ color: ink, fontSize: 24 }}>‹</Text>
        </Pressable>
        <View
          accessibilityLiveRegion="polite"
          style={{ flex: 1, alignItems: "center", gap: 3 }}
        >
          <Text style={{ color: ink, fontSize: 13, textAlign: "center" }}>
            {label(selected)}
          </Text>
          <Text style={{ color: ink, fontSize: 20, fontWeight: "600" }}>
            {selected.value === null
              ? "Sans donnée"
              : formatCurrency(selected.value)}
          </Text>
          <Text style={{ color: muted, fontSize: 11, textAlign: "center" }}>
            {measure} · {status(selected)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Valeur suivante"
          disabled={index === bins.length - 1}
          accessibilityState={{ disabled: index === bins.length - 1 }}
          onPress={() => select(index + 1)}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: index === bins.length - 1 ? 0.35 : 1,
          }}
        >
          <Text style={{ color: ink, fontSize: 24 }}>›</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => onDrill(selected.date)}
        style={{
          backgroundColor: inverse ? colors.accent : colors.forestSoft,
          borderRadius: 12,
          minHeight: 44,
          padding: 12,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: inverse ? colors.onAccent : colors.forest,
            fontWeight: "600",
            fontSize: 13,
          }}
        >
          {selected.monthly ? "Voir cette période" : "Voir cette journée"} →
        </Text>
      </Pressable>
    </View>
  );
}
