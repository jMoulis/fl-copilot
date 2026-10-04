import { Text, View } from "react-native";
import { router, type Href } from "expo-router";
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
import { useOpenSyncConflicts } from "@/sync/use-sync-conflicts";
import { conflictEntityLabel } from "@/sync/conflict-presentation";
import { useOpenImportVerificationConflicts } from "@/documents/use-import-verification-conflicts";

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
  const conflicts = useOpenSyncConflicts(store?.storeId, conflictCount);
  const importVerificationConflicts = useOpenImportVerificationConflicts(
    store?.storeId,
    conflictCount,
  );

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

      {importVerificationConflicts.length > 0 ? (
        <SectionCard title="Vérifications d’import à examiner">
          {importVerificationConflicts.map((conflict) => (
            <View
              key={conflict.sourceDocumentId}
              className="gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
            >
              <Text className="text-base font-semibold text-ink">
                {conflict.filename ?? sourceTypeLabel(conflict.sourceType)}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                Les données locales et la vérification distante ne correspondent
                pas exactement.
              </Text>
              <SecondaryButton
                label="Examiner"
                onPress={() =>
                  router.push(
                    `/(tabs)/import-verification/${conflict.sourceDocumentId}` as Href,
                  )
                }
              />
            </View>
          ))}
        </SectionCard>
      ) : null}

      {conflicts.length > 0 ? (
        <SectionCard title="Conflits à examiner">
          {conflicts.map((conflict) => (
            <View
              key={conflict.id}
              className="gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
            >
              <Text className="text-base font-semibold text-ink">
                {conflictEntityLabel(conflict)}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                Cette donnée a été modifiée sur un autre appareil.
              </Text>
              <SecondaryButton
                label="Examiner"
                onPress={() =>
                  router.push(`/(tabs)/sync-conflict/${conflict.id}` as Href)
                }
              />
            </View>
          ))}
        </SectionCard>
      ) : null}

      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}

function sourceTypeLabel(sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE") {
  return sourceType === "MERCALYS_SALES" ? "Ventes Mercalys" : "Casse Mercalys";
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
