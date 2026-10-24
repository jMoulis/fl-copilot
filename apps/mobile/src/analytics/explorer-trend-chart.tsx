import { useEffect, useRef } from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import {
  explorerChartBuckets,
  parseDecimal,
  type DatedKpiValue,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import { colors } from "../design/tokens";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { formatCurrency } from "../today/today-priority-presentation";
/** Shared monetary chart: dates/aggregation/availability come from the canonical Explorer. */
export function ExplorerTrendChart({
  period,
  points,
  scrollOffset = 0,
  onChartScroll,
  onDrill,
}: {
  period: ExplorerPeriod;
  points: readonly DatedKpiValue[];
  scrollOffset?: number;
  onChartScroll?(offset: number): void;
  onDrill(date: string): void;
}) {
  const chart = useRef<ScrollView>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      chart.current?.scrollTo({ x: scrollOffset, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [period, scrollOffset]);
  const bins = points ? explorerChartBuckets(period, points) : [],
    max = bins.reduce((n, b) => {
      if (b.value === null) return n;
      const v = parseDecimal(b.value).value.abs();
      return v.greaterThan(n) ? v : n;
    }, parseDecimal("0").value);
  return (
    <ScrollView
      ref={chart}
      onScroll={(e) =>
        onChartScroll?.(Math.max(0, e.nativeEvent.contentOffset.x))
      }
      scrollEventThrottle={120}
      horizontal
      indicatorStyle="white"
      showsHorizontalScrollIndicator
      keyboardShouldPersistTaps="handled"
      directionalLockEnabled
      nestedScrollEnabled
      style={{ maxWidth: "100%" }}
      contentContainerStyle={{
        gap: 3,
        flexGrow: 1,
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
                      parseDecimal(b.value).value.abs().div(max).toNumber() *
                        100,
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
            : b.date.slice(8),
          periodLabel =
            b.date === b.end
              ? formatFrenchCalendarDate(b.date)
              : `Du ${formatFrenchCalendarDate(b.date)} au ${formatFrenchCalendarDate(b.end)}`,
          measureLabel =
            period.kind === "range" && period.aggregation === "AVERAGE"
              ? "moyenne des jours renseignés"
              : b.monthly
                ? "cumul renseigné"
                : "montant renseigné";
        return (
          <Pressable
            key={b.date}
            accessibilityRole="button"
            accessibilityLabel={`${periodLabel} : ${b.value === null ? "sans donnée" : `${measureLabel} ${formatCurrency(b.value)}`}${b.complete ? "" : " · données incomplètes"}. Ouvrir le détail.`}
            onPress={() => onDrill(b.date)}
            style={{
              minWidth: 48,
              width: 48,
              flexGrow: 1,
              minHeight: 190,
              justifyContent: "flex-start",
              alignItems: "center",
              gap: 7,
            }}
          >
            <View
              style={{
                height: 132,
                width: 26,
                justifyContent: "flex-end",
                borderBottomWidth: 1,
                borderColor: colors.line,
              }}
            >
              {b.value !== null ? (
                <View
                  style={{
                    height: height * 1.28,
                    width: 26,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: negative ? colors.critical : colors.forest,
                    opacity: b.complete ? 1 : 0.5,
                    borderTopWidth: 2,
                    borderColor: colors.positive,
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
            <Text style={{ color: colors.ink, fontSize: 12 }}>{label}</Text>
            <Text
              style={{
                fontSize: 10,
                lineHeight: 13,
                minHeight: 26,
                textAlign: "center",
                color: colors.warning,
              }}
            >
              {!b.complete
                ? b.value === null
                  ? "Sans donnée"
                  : "Partiel"
                : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
