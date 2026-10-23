import { randomUUID } from "expo-crypto";
import { explorerHref } from "../analytics/explorer-link";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import {
  InlineAlert,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "../components/ui";
import { DashboardMetric, DetailsDisclosure } from "../components/dashboard";
import { colors } from "../design/tokens";
import {
  LinkedProductVisual,
  type SharedProductVisuals,
} from "../products/linked-product-visual";
import type {
  TodayMovement,
  TodayPriority,
  TodaySummary,
} from "./today-summary";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercentage,
  priorityFact,
  priorityPresentation,
} from "./today-priority-presentation";

type TodayVisualProps = { storeId?: string; visuals?: SharedProductVisuals };
export function TodayContent({
  summary,
  storeId,
  visuals,
}: { summary: TodaySummary } & TodayVisualProps) {
  const { fontScale, width } = useWindowDimensions();
  const columns = fontScale <= 1.3 && width >= 360;
  return (
    <>
      <View className="gap-3">
        <View className="flex-row flex-wrap gap-3">
          {summary.kpis.map((kpi, index) => (
            <Pressable
              key={kpi.id}
              style={{
                width: columns && index > 0 ? "48%" : "100%",
                flexGrow: 1,
              }}
              accessibilityRole="button"
              accessibilityLabel={`${kpi.label} : ${formatCurrency(kpi.value) ?? "indisponible"}${kpi.status === "PARTIAL" && kpi.value !== null ? ", cumul partiel" : ""}. ${comparisonLabel(kpi.comparison)}. Explorer la journée analysée.`}
              accessibilityHint="Ouvre Analyses pour cette date, avec une référence ISO N−1 distincte des écarts J−7 affichés ici."
              onPress={() =>
                router.navigate(
                  explorerHref({
                    requestId: randomUUID(),
                    period: { kind: "day", date: summary.businessDate },
                    metric: kpi.id === "waste" ? "wasteCost" : kpi.id,
                  }),
                )
              }
            >
              <DashboardMetric
                compact={columns && index > 0}
                icon={
                  kpi.id === "sales"
                    ? "bag-handle-outline"
                    : kpi.id === "margin"
                      ? "trending-up-outline"
                      : "trash-outline"
                }
                label={kpi.label}
                tone={
                  kpi.comparison.status !== "AVAILABLE" ||
                  kpi.comparison.percentageDifference === null
                    ? "neutral"
                    : Number(kpi.comparison.percentageDifference) >= 0 !==
                        (kpi.id === "waste")
                      ? "positive"
                      : "critical"
                }
                value={formatCurrency(kpi.value)}
                qualifier={
                  kpi.status === "PARTIAL" && kpi.value !== null
                    ? "Cumul partiel"
                    : undefined
                }
                detail={comparisonLabel(kpi.comparison)}
              />
            </Pressable>
          ))}
        </View>
        <DetailsDisclosure
          title={`${summary.productCount} produits · Écarts à J−7`}
        >
          <Text className="text-xs leading-5 text-muted">
            Touchez un indicateur pour explorer la journée et sa référence N−1.
            Les écarts ci-dessus restent comparés à J−7.
          </Text>
          <Text className="text-xs leading-5 text-muted">
            {summary.productCount} produit
            {summary.productCount > 1 ? "s" : ""} calculé
            {summary.productCount > 1 ? "s" : ""} · Mise à jour{" "}
            {formatFreshness(summary.computedAt)}
          </Text>
        </DetailsDisclosure>
      </View>

      <View className="gap-3">
        <Text
          accessibilityRole="header"
          className="text-lg font-semibold text-ink"
        >
          Priorités du rayon
        </Text>
        {summary.priorities.length === 0 ? (
          <Text className="text-base leading-6 text-muted">
            Aucune priorité ne dépasse les seuils actuels pour cette journée.
          </Text>
        ) : (
          <View className="gap-3">
            {summary.priorities.map((priority) => (
              <PriorityCard
                key={priority.id}
                priority={priority}
                storeId={storeId}
                visuals={visuals}
              />
            ))}
          </View>
        )}
      </View>

      <SectionCard
        title="Mouvements clés"
        description="Écarts économiques les plus importants par rapport à J-7."
      >
        {summary.movements.length === 0 ? (
          <Text className="text-base leading-6 text-muted">
            Les mouvements apparaîtront lorsqu’une journée comparable J-7 sera
            disponible.
          </Text>
        ) : (
          <View className="gap-1">
            {summary.movements.map((movement) => (
              <MovementRow
                key={movement.id}
                movement={movement}
                storeId={storeId}
                visuals={visuals}
              />
            ))}
          </View>
        )}
      </SectionCard>

      {summary.dataQuality.alertMessage ? (
        <View className="gap-3">
          <InlineAlert
            title="Données à vérifier"
            message={summary.dataQuality.alertMessage}
          />
          {summary.dataQuality.unresolvedProductCount > 0 ? (
            <SecondaryButton
              label="Voir les imports"
              onPress={() => router.push("/(tabs)/imports" as Href)}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function PriorityCard({
  priority,
  storeId,
  visuals,
}: { priority: TodayPriority } & TodayVisualProps) {
  const presentation = priorityPresentation(priority);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${priority.rank}. ${presentation.title}. ${priorityFact(priority)}. ${presentation.reason}`}
      onPress={() =>
        router.push({
          pathname: "/(tabs)/priority/[id]",
          params: { id: priority.id },
        } as Href)
      }
      className="gap-2 rounded-2xl border border-line bg-surface p-4"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <View className="flex-row items-center gap-3">
        <View>
          {storeId && visuals ? (
            <LinkedProductVisual
              storeId={storeId}
              productId={priority.productId}
              visuals={visuals}
              size={56}
            />
          ) : null}
          <View
            className={
              storeId && visuals
                ? "absolute -left-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-forest"
                : "h-10 w-10 items-center justify-center rounded-full bg-forest-soft"
            }
          >
            <Text
              className={
                storeId && visuals
                  ? "text-xs font-bold text-on-accent"
                  : "text-base font-bold text-forest"
              }
            >
              {priority.rank}
            </Text>
          </View>
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-xs font-semibold text-warning">
            {presentation.heading}
          </Text>
          <Text className="text-base font-semibold text-ink">
            {priority.productLabel}
          </Text>
          <Text className="text-sm text-ink">{priorityFact(priority)}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.muted}
          accessible={false}
        />
      </View>
      <Text className="text-sm leading-5 text-muted">
        {presentation.reason}
      </Text>
      <Text className="text-sm leading-5 text-ink">{presentation.action}</Text>
      {priority.status === "LOW_QUALITY" ? (
        <StatusBadge status="incomplete" compact />
      ) : null}
    </Pressable>
  );
}

function MovementRow({
  movement,
  storeId,
  visuals,
}: { movement: TodayMovement } & TodayVisualProps) {
  const positive = isPositiveMovement(movement);
  const trendIcon =
    Number(movement.absoluteDifference) >= 0 ? "trending-up" : "trending-down";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${movement.productLabel}. ${movementLabel(movement)}`}
      onPress={() =>
        router.push(`/(tabs)/products/${movement.productId}` as Href)
      }
      className="flex-row items-center gap-3 border-b border-line py-3"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      {storeId && visuals ? (
        <LinkedProductVisual
          storeId={storeId}
          productId={movement.productId}
          visuals={visuals}
          size={44}
        />
      ) : (
        <View
          className={`rounded-xl p-2 ${positive ? "bg-positive-soft" : "bg-critical-soft"}`}
        >
          <Ionicons
            name={trendIcon}
            size={20}
            color={positive ? colors.positive : colors.critical}
            accessible={false}
          />
        </View>
      )}
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink">
          {movement.productLabel}
        </Text>
        <View className="flex-row items-center gap-1">
          {storeId && visuals ? (
            <Ionicons
              name={trendIcon}
              size={16}
              color={positive ? colors.positive : colors.critical}
              accessible={false}
            />
          ) : null}
          <Text className="flex-1 text-sm leading-5 text-muted">
            {movementLabel(movement)}
          </Text>
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.muted}
        accessible={false}
      />
    </Pressable>
  );
}

function movementLabel(movement: TodayMovement) {
  const metric =
    movement.metric === "SALES"
      ? "ventes"
      : movement.metric === "MARGIN"
        ? "marge"
        : "casse";
  const amount = formatSignedCurrency(movement.absoluteDifference);
  const percentage = formatSignedPercentage(movement.percentageDifference);
  return `${amount} de ${metric}${percentage ? ` · ${percentage}` : ""}`;
}

function comparisonLabel(
  comparison: TodaySummary["kpis"][number]["comparison"],
) {
  if (
    comparison.status === "UNAVAILABLE" ||
    comparison.absoluteDifference === null
  ) {
    return "Comparaison J-7 indisponible";
  }
  const percentage = formatSignedPercentage(comparison.percentageDifference);
  const detail = percentage
    ? `${percentage} vs J-7`
    : `${formatSignedCurrency(comparison.absoluteDifference)} vs J-7`;
  return comparison.status === "PARTIAL"
    ? `Comparaison partielle · ${detail}`
    : detail;
}

function isPositiveMovement(movement: TodayMovement) {
  const positive = Number(movement.absoluteDifference) >= 0;
  return movement.metric === "WASTE" ? !positive : positive;
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
