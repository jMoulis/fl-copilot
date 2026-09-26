import { Text, View } from "react-native";
import { router } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";

export default function SynchronizationScreen() {
  const { session } = useAuth();
  const {
    status,
    pendingCount,
    conflictCount,
    failedCount,
    lastSyncedAt,
    syncNow,
  } = useSync();
  const store = session?.stores[0];

  return (
    <AppScreen>
      <AppHeader
        title="Synchronisation"
        subtitle={
          store
            ? `Données locales et partagées de ${store.name}.`
            : "Données locales et partagées du magasin."
        }
      />

      <SectionCard title="État actuel">
        <View accessibilityLiveRegion="polite">
          <StatusBadge status={status} />
        </View>
        <StatusLine
          label="Modifications en attente"
          value={String(pendingCount)}
        />
        <StatusLine label="Conflits" value={String(conflictCount)} />
        <StatusLine label="Erreurs" value={String(failedCount)} />
        <StatusLine
          label="Dernière synchronisation"
          value={formatSyncDate(lastSyncedAt)}
        />
        <PrimaryButton
          label="Synchroniser maintenant"
          loading={status === "syncing"}
          disabled={!store}
          onPress={() => {
            void syncNow(store?.storeId);
          }}
        />
      </SectionCard>

      {status === "offline" ? (
        <InlineAlert
          title="Hors connexion"
          message="Vos données restent disponibles. La synchronisation reprendra avec le réseau."
        />
      ) : null}
      {status === "conflict" ? (
        <InlineAlert
          title="Conflit à examiner"
          message="Une modification locale doit être comparée avec la version partagée."
        />
      ) : null}
      {status === "error" ? (
        <InlineAlert
          title="Synchronisation incomplète"
          message="Certaines modifications n’ont pas pu être traitées. Réessayez maintenant."
        />
      ) : null}

      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4 border-t border-line pt-3">
      <Text className="flex-1 text-sm text-muted">{label}</Text>
      <Text className="text-right text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}

function formatSyncDate(value?: string) {
  if (!value) return "Pas encore effectuée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
