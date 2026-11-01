import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { CopilotChart } from "@fl-copilot/domain";
import { colors } from "../design/tokens";
import { formatFrenchCalendarDate } from "../dates/calendar";
const palette = [colors.forest, colors.warning];
/** Snapshot only: scale/drawing are presentation; no reads, KPI arithmetic or interpolation of gaps. */
export function AnswerChart({
  chart,
  onSource,
}: {
  chart: CopilotChart;
  onSource(): void;
}) {
  const [selected, setSelected] = useState(0);
  const money = (value: string | null) => {
    if (value === null) return "Sans donnée";
    const numeric = Number(value);
    const suffix = {
      KG: "kg",
      PIECE: "pièces enregistrées",
      PACK: "unités conditionnées",
      EUR_PER_KG: "€/kg",
      EUR_PER_PIECE: "€/pièce",
      EUR_PER_PACK: "€/unité conditionnée",
    };
    return chart.unit === "EUR"
      ? numeric.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
      : `${numeric.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${suffix[chart.unit]}`;
  };
  const active = Math.min(selected, chart.labels.length - 1);
  const values = chart.series.flatMap((s) =>
    s.points.flatMap((p) => (p.value === null ? [] : [Number(p.value)])),
  );
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const y = (value: number) => 150 - ((value - min) / span) * 140;
  const zero = y(0),
    width = Math.max(280, chart.labels.length * 64);
  const x = (i: number) => 32 + i * 64;
  const partial = chart.series.some((s) =>
    s.points.some((p) => p.status !== "AVAILABLE"),
  );
  return (
    <View
      style={{
        gap: 10,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 16,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>
        {chart.title}
      </Text>
      {chart.series.map((s, i) => (
        <Text key={i} style={{ color: palette[i], fontSize: 12 }}>
          {s.label} · {formatFrenchCalendarDate(s.period.start)} –{" "}
          {formatFrenchCalendarDate(s.period.end)}
        </Text>
      ))}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>
        {chart.labels[active]}
        {chart.series
          .map(
            (s) => ` · ${s.label} : ${money(s.points[active]?.value ?? null)}`,
          )
          .join("")}
      </Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator
        accessibilityLabel="Graphique, faites défiler pour consulter les valeurs"
      >
        <View style={{ width, height: 220 }}>
          <View
            style={{
              position: "absolute",
              top: zero,
              width,
              height: 1,
              backgroundColor: colors.line,
            }}
          />
          {chart.series.flatMap((s, series) =>
            s.points.map((p, i) => {
              if (p.value === null) return null;
              const top = y(Number(p.value)),
                next = s.points[i + 1];
              if (chart.type === "BARS")
                return (
                  <View
                    key={`${series}:${i}`}
                    style={{
                      position: "absolute",
                      left: x(i) - 20 + series * 20,
                      top: Math.min(top, zero),
                      width: 16,
                      height: Math.max(2, Math.abs(zero - top)),
                      backgroundColor: palette[series],
                      opacity: p.status === "PARTIAL" ? 0.55 : 1,
                    }}
                  />
                );
              const dx = 64,
                dy =
                  next?.value !== null && next?.value !== undefined
                    ? y(Number(next.value)) - top
                    : 0;
              return (
                <View key={`${series}:${i}`}>
                  {next?.value !== null && next?.value !== undefined ? (
                    <View
                      style={{
                        position: "absolute",
                        left: x(i),
                        top,
                        width: Math.hypot(dx, dy),
                        height: 2,
                        backgroundColor: palette[series],
                        transformOrigin: "left center",
                        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                      }}
                    />
                  ) : null}
                  <View
                    style={{
                      position: "absolute",
                      left: x(i) - 3,
                      top: top - 3,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: palette[series],
                    }}
                  />
                </View>
              );
            }),
          )}
          {chart.labels.map((label, i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${chart.series.map((s) => `${s.label} : ${money(s.points[i]!.value)}${s.points[i]!.status === "PARTIAL" ? ", partiel" : ""}`).join(". ")}`}
              onPress={() => setSelected(i)}
              style={{
                position: "absolute",
                left: i * 64,
                width: 64,
                top: 0,
                height: 220,
                justifyContent: "flex-end",
                padding: 3,
              }}
            >
              <Text
                numberOfLines={3}
                style={{
                  color: active === i ? colors.forest : colors.muted,
                  fontSize: 11,
                  height: 54,
                }}
              >
                {chart.type === "LINE"
                  ? formatFrenchCalendarDate(label).slice(0, 5)
                  : label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {chart.qualification ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {chart.qualification}
        </Text>
      ) : null}
      {partial ? (
        <Text style={{ color: colors.warning, fontSize: 12 }}>
          Données partielles : les valeurs absentes restent inconnues.
        </Text>
      ) : null}
      <Pressable accessibilityRole="link" onPress={onSource}>
        <Text style={{ color: colors.forest, textDecorationLine: "underline" }}>
          Source et détail des données
        </Text>
      </Pressable>
    </View>
  );
}
