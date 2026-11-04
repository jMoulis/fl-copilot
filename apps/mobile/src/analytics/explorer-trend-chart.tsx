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
  const bins = explorerChartBuckets(period, points);
  const bounds = bins.reduce(
    (range, bucket) => {
      if (bucket.value === null) return range;
      const value = parseDecimal(bucket.value).value;
      if (value.isNegative()) {
        const magnitude = value.abs();
        if (magnitude.greaterThan(range.negative)) range.negative = magnitude;
      } else if (value.greaterThan(range.positive)) range.positive = value;
      return range;
    },
    { positive: parseDecimal("0").value, negative: parseDecimal("0").value },
  );
  const span = bounds.positive.add(bounds.negative);
  const zero = span.isZero()
    ? 130
    : 2 + bounds.positive.div(span).toNumber() * 128;
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: 24 }}>
        <Text
          accessibilityLabel="Niveau zéro euro"
          style={{
            position: "absolute",
            top: zero,
            color: colors.muted,
            fontSize: 10,
          }}
        >
          0
        </Text>
      </View>
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
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 3,
          flexGrow: 1,
          alignItems: "flex-start",
          paddingVertical: 8,
        }}
      >
        {bins.map((b) => {
          const amount = b.value === null ? null : parseDecimal(b.value).value,
            negative = amount?.isNegative() ?? false,
            height =
              amount === null
                ? 0
                : span.isZero()
                  ? 2
                  : Math.max(2, amount.abs().div(span).toNumber() * 128),
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
                  width: 48,
                }}
              >
                <View
                  style={{
                    position: "absolute",
                    top: zero,
                    width: 48,
                    height: 1,
                    backgroundColor: colors.muted,
                  }}
                />
                {b.value !== null ? (
                  <View
                    style={{
                      position: "absolute",
                      top: negative
                        ? zero
                        : amount?.isZero()
                          ? zero
                          : zero - height,
                      left: 11,
                      height,
                      width: 26,
                      borderTopLeftRadius: negative ? 0 : 4,
                      borderTopRightRadius: negative ? 0 : 4,
                      borderBottomLeftRadius: negative ? 4 : 0,
                      borderBottomRightRadius: negative ? 4 : 0,
                      backgroundColor: negative
                        ? colors.critical
                        : colors.forest,
                      opacity: b.complete ? 1 : 0.5,
                      borderTopWidth: 2,
                      borderColor: negative ? colors.critical : colors.positive,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      position: "absolute",
                      left: 11,
                      top: Math.min(112, Math.max(0, zero - 10)),
                      height: 20,
                      width: 26,
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
    </View>
  );
}
