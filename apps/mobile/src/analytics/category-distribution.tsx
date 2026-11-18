import { Text, View, Pressable } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { categoryShares } from "@fl-copilot/analytics-core";
import { colors } from "../design/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatCurrency } from "../today/today-priority-presentation";
import type { ExplorerRepository } from "./explorer-repository";
type Category = NonNullable<
  Awaited<ReturnType<ExplorerRepository["load"]>>["details"]
>["categories"][number];
const palette = {
  FRUIT: colors.forest,
  VEGETABLE: colors.accent,
  OTHER: colors.info,
  UNKNOWN: colors.warning,
};
export function CategoryDistribution({
  categories,
  average = false,
  onCategory,
  onInfo,
}: {
  categories: readonly Category[];
  average?: boolean;
  onCategory(category: Category["category"]): void;
  onInfo(category: Category["category"]): void;
}) {
  const chart = categoryShares(
    categories.map((c) => ({ category: c.category, amount: c.analysis.total })),
    average ? "AVERAGE" : "SUM",
  );
  const circumference = 2 * Math.PI * 48;
  let offset = 0;
  const description = chart.slices
    .map(
      (s) =>
        `${categories.find((c) => c.category === s.category)!.label} : ${s.percentage.replace(".", ",")} %`,
    )
    .join(" ; ");
  return (
    <View style={{ gap: 10 }}>
      {chart.slices.length ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
          }}
        >
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Répartition des montants renseignés. ${description}${chart.missing ? ". Catégories sans montant exclues, part inconnue." : ""}`}
            style={{ width: 132, height: 132 }}
          >
            <Svg
              width={132}
              height={132}
              viewBox="0 0 132 132"
              accessible={false}
            >
              {chart.slices.map((s) => {
                const start = offset;
                offset += s.fraction * circumference;
                return (
                  <Circle
                    key={s.category}
                    cx={66}
                    cy={66}
                    r={48}
                    fill="none"
                    stroke={palette[s.category]}
                    strokeWidth={22}
                    strokeDasharray={[
                      s.fraction * circumference,
                      circumference,
                    ]}
                    strokeDashoffset={-start}
                    rotation={-90}
                    origin="66,66"
                  />
                );
              })}
            </Svg>
          </View>
          <View style={{ flex: 1, minWidth: 130, gap: 5 }}>
            <Text
              style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}
            >
              Montants renseignés
            </Text>
            <Text
              style={{ color: colors.ink, fontSize: 20, fontWeight: "600" }}
            >
              {formatCurrency(chart.total!)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              Somme des catégories de la sélection
            </Text>
            {chart.missing ? (
              <Text style={{ color: colors.warning, fontSize: 12 }}>
                Répartition partielle · {chart.missing} catégorie
                {chart.missing > 1 ? "s" : ""} sans montant
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {chart.reason === "NEGATIVE"
            ? "Répartition circulaire non représentée : des montants sont négatifs."
            : chart.reason === "AVERAGE"
              ? "Répartition circulaire non représentée pour une moyenne."
              : "Pas de montant positif disponible pour la répartition."}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {categories.map((c) => {
          const share = chart.slices.find((s) => s.category === c.category);
          return (
            <View
              key={c.category}
              style={{
                flexDirection: "row",
                alignItems: "center",
                maxWidth: "100%",
                borderRadius: 14,
                backgroundColor: colors.surfaceMuted,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Explorer ${c.label}`}
                onPress={() => onCategory(c.category)}
                style={{
                  flexShrink: 1,
                  minHeight: 44,
                  paddingVertical: 8,
                  paddingLeft: 10,
                  paddingRight: 4,
                  gap: 3,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: palette[c.category],
                    }}
                  />
                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 12,
                      fontWeight: "600",
                      flexShrink: 1,
                    }}
                  >
                    {c.label}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {c.analysis.total === null
                    ? "Indisponible"
                    : formatCurrency(c.analysis.total)}
                  {share ? ` · ${share.percentage.replace(".", ",")} %` : ""}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Informations sur les chiffres : ${c.label}`}
                onPress={() => onInfo(c.category)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
