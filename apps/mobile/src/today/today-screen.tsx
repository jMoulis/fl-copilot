import { StoreEventsView } from "@/needs/store-events-view";
import { router, type Href } from "expo-router";
import { Text, View } from "react-native";
import {
  AppHeader,
  AppScreen,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
import { IconButton } from "@/components/dashboard";
import { useSync } from "@/sync/sync-provider";
import { formatBusinessDate } from "./today-priority-presentation";
import { useTodaySummary } from "./use-today-summary";
import { TodayContent } from "./today-overview";

export default function TodayScreen() {
  const { loading, refreshing, storeMissing, summary, error, refresh } =
    useTodaySummary();
  const sync = useSync();

  return (
    <AppScreen
      refreshing={refreshing}
      onRefresh={() => {
        void refresh();
      }}
    >
      <AppHeader
        compact
        title="Votre rayon aujourd’hui"
        action={
          <IconButton
            label="Magasin et synchronisation"
            icon="options-outline"
            onPress={() => router.push("/(tabs)/more" as Href)}
          />
        }
        subtitle={
          summary
            ? `Journée analysée : ${formatBusinessDate(summary.businessDate)}`
            : "Un regard clair sur votre rayon."
        }
      >
        {summary ? (
          <View className="flex-row flex-wrap gap-2 pt-1">
            {summary.origin === "LOCAL" ? (
              <StatusBadge status="local" compact />
            ) : null}
            <StatusBadge status={sync.status} compact />
          </View>
        ) : null}
      </AppHeader>

      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}

      {storeMissing ? (
        <InlineAlert
          title="Aucun magasin actif"
          message="Reconnectez-vous après l’ajout de votre magasin."
        />
      ) : loading ? (
        <Text className="text-base text-muted">Préparation de la journée…</Text>
      ) : summary ? (
        <>
          <TodayContent summary={summary} />
          <StoreEventsView compact />
        </>
      ) : error ? null : (
        <EmptyToday />
      )}
      <SecondaryButton
        label="Signaler une observation magasin"
        disabled={storeMissing}
        onPress={() => router.push("/store-event" as Href)}
      />
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
