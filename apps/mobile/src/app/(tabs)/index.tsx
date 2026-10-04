import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";
import {
  AppHeader,
  AppScreen,
  EmptyState,
  InlineAlert,
  MetricCard,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import { colors } from "@/design/tokens";
import { useSync } from "@/sync/sync-provider";
import type {
  TodayMovement,
  TodayPriority,
  TodaySummary,
} from "@/today/today-summary";
import { useTodaySummary } from "@/today/use-today-summary";

export default function TodayScreen() {
  const { loading, storeMissing, summary, error } = useTodaySummary();
  const sync = useSync();

  return (
    <AppScreen>
      <AppHeader
        title="Aujourd’hui"
        subtitle={
          summary
            ? `Journée analysée : ${formatBusinessDate(summary.businessDate)}`
            : "Un regard clair sur votre rayon."
        }
      >
        {summary ? (
          <View className="flex-row flex-wrap gap-2 pt-1">
            {summary.origin === "LOCAL" ? <StatusBadge status="local" /> : null}
            <StatusBadge status={sync.status} />
          </View>
        ) : null}
      </AppHeader>

      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : storeMissing ? (
        <InlineAlert
          title="Aucun magasin actif"
          message="Reconnectez-vous après l’ajout de votre magasin."
        />
      ) : loading ? (
        <Text className="text-base text-muted">Préparation de la journée…</Text>
      ) : !summary ? (
        <EmptyToday />
      ) : (
        <TodayContent summary={summary} />
      )}
    </AppScreen>
  );
}

function EmptyToday() {
  return (
    <EmptyState
      title="Aucune journée analysable"
      message="Importez les ventes Mercalys pour afficher vos indicateurs et vos premières priorités."
      icon="analytics-outline"
    >
      <PrimaryButton
        label="Importer les ventes"
        onPress={() => router.push("/(tabs)/imports" as Href)}
      />
      <SecondaryButton
        label="Voir les produits"
        onPress={() => router.push("/(tabs)/products" as Href)}
      />
    </EmptyState>
  );
}

function TodayContent({ summary }: { summary: TodaySummary }) {
  return (
    <>
      <View className="gap-3">
        {summary.kpis.map((kpi) => (
          <MetricCard
            key={kpi.id}
            label={kpi.label}
            value={formatCurrency(kpi.value)}
            detail={comparisonLabel(kpi.comparison)}
          />
        ))}
        <Text className="text-xs leading-5 text-muted">
          {summary.productCount} produit
          {summary.productCount > 1 ? "s" : ""} calculé
          {summary.productCount > 1 ? "s" : ""} · Mise à jour{" "}
          {formatFreshness(summary.computedAt)}
        </Text>
      </View>

      <SectionCard
        title="Priorités"
        description="Trois signaux déterministes maximum, classés par impact."
      >
        {summary.priorities.length === 0 ? (
          <Text className="text-base leading-6 text-muted">
            Aucune priorité ne dépasse les seuils actuels pour cette journée.
          </Text>
        ) : (
          <View className="gap-3">
            {summary.priorities.map((priority) => (
              <PriorityCard key={priority.id} priority={priority} />
            ))}
          </View>
        )}
      </SectionCard>

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
              <MovementRow key={movement.id} movement={movement} />
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard title="Tensions magasin">
        <View className="flex-row items-start gap-3">
          <Ionicons
            name="checkmark-circle-outline"
            size={22}
            color={colors.positive}
            accessible={false}
          />
          <Text className="flex-1 text-base leading-6 text-muted">
            Aucune tension magasin n’est enregistrée pour cette journée.
          </Text>
        </View>
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

function PriorityCard({ priority }: { priority: TodayPriority }) {
  const presentation = priorityPresentation(priority);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${priority.rank}. ${presentation.title}. ${presentation.reason}`}
      onPress={() =>
        router.push(`/(tabs)/products/${priority.productId}` as Href)
      }
      className="gap-3 rounded-2xl bg-surface-muted p-4"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-forest">
          <Text className="text-base font-bold text-white">
            {priority.rank}
          </Text>
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-forest">
            Signal déterministe
          </Text>
          <Text className="text-lg font-semibold text-ink">
            {presentation.title}
          </Text>
          <Text className="text-sm leading-5 text-muted">
            {presentation.reason}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.muted}
          accessible={false}
        />
      </View>
      <View className="rounded-xl bg-white px-3 py-2">
        <Text className="text-sm font-semibold text-ink">
          {priorityFact(priority)}
        </Text>
      </View>
      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-wider text-muted">
          Action proposée
        </Text>
        <Text className="text-sm leading-5 text-ink">
          {presentation.action}
        </Text>
      </View>
      {priority.status === "LOW_QUALITY" ? (
        <StatusBadge status="incomplete" />
      ) : null}
    </Pressable>
  );
}

function MovementRow({ movement }: { movement: TodayMovement }) {
  const positive = isPositiveMovement(movement);
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
      <View
        className={`rounded-xl p-2 ${positive ? "bg-positive-soft" : "bg-critical-soft"}`}
      >
        <Ionicons
          name={positive ? "trending-up" : "trending-down"}
          size={20}
          color={positive ? colors.positive : colors.critical}
          accessible={false}
        />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink">
          {movement.productLabel}
        </Text>
        <Text className="text-sm leading-5 text-muted">
          {movementLabel(movement)}
        </Text>
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

function priorityPresentation(priority: TodayPriority) {
  if (priority.type === "WASTE_SPIKE") {
    return {
      title: `Contrôler la casse — ${priority.productLabel}`,
      reason: "La casse augmente par rapport à J-7.",
      action: "Vérifier le stock, la maturité et la rotation aujourd’hui.",
    };
  }
  if (priority.type === "SALES_DROP") {
    return {
      title: `Vérifier les ventes — ${priority.productLabel}`,
      reason: "Les ventes reculent par rapport à J-7.",
      action: "Contrôler la disponibilité, le prix et la mise en avant.",
    };
  }
  if (priority.type === "MARGIN_DROP") {
    return {
      title: `Examiner la marge — ${priority.productLabel}`,
      reason: "La marge baisse par rapport à J-7.",
      action: "Vérifier le prix de vente et le coût d’achat.",
    };
  }
  return {
    title: `Vérifier les données — ${priority.productLabel}`,
    reason:
      "Les données disponibles sont insuffisantes pour une lecture fiable.",
    action: "Contrôler les imports et l’association du produit.",
  };
}

function priorityFact(priority: TodayPriority) {
  const current = formatCurrency(priority.currentValue);
  const variation = formatSignedPercentage(priority.percentageDifference);
  if (current && variation) return `${current} · ${variation} vs J-7`;
  if (current) return current;
  return `Qualité des données : ${Math.round(priority.dataQualityScore * 100)} %`;
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
  return percentage
    ? `${percentage} vs J-7`
    : `${formatSignedCurrency(comparison.absoluteDifference)} vs J-7`;
}

function isPositiveMovement(movement: TodayMovement) {
  const positive = Number(movement.absoluteDifference) >= 0;
  return movement.metric === "WASTE" ? !positive : positive;
}

function formatCurrency(value: string | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatSignedCurrency(value: string) {
  const amount = Number(value);
  const formatted = formatCurrency(String(Math.abs(amount))) ?? "";
  return `${amount >= 0 ? "+" : "−"}${formatted}`;
}

function formatSignedPercentage(value: string | null) {
  if (value === null) return null;
  const percentage = Number(value);
  return `${percentage >= 0 ? "+" : "−"}${Math.abs(percentage).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
