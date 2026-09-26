import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
import {
  conflictEntityLabel,
  conflictPayloadSummary,
} from "@/sync/conflict-presentation";
import { useSyncConflict } from "@/sync/use-sync-conflicts";

export default function SyncConflictDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const conflict = useSyncConflict(id);

  return (
    <AppScreen>
      <AppHeader
        title="Conflit de synchronisation"
        subtitle="Comparez les deux versions avant de choisir une résolution sûre."
      />

      {conflict === undefined ? (
        <Text className="text-base text-muted">Chargement du conflit…</Text>
      ) : conflict === null ? (
        <InlineAlert
          title="Conflit indisponible"
          message="Ce conflit n’existe plus ou a déjà été traité."
        />
      ) : (
        <>
          <InlineAlert
            title={conflictEntityLabel(conflict)}
            message="Cette donnée a été modifiée sur un autre appareil. Votre version locale a été conservée."
          />

          <SectionCard title="Votre version">
            <Text className="text-base leading-6 text-ink">
              {conflictPayloadSummary(
                conflict.localPayload,
                "Version locale indisponible.",
              )}
            </Text>
          </SectionCard>

          <SectionCard title="Version synchronisée">
            <Text className="text-base leading-6 text-ink">
              {conflictPayloadSummary(
                conflict.remotePayload,
                "Aucune version distante disponible.",
              )}
            </Text>
          </SectionCard>

          <SectionCard title="Actions autorisées">
            <Text className="text-base leading-6 text-muted">
              Les choix de résolution seront proposés selon les règles métier de
              cette donnée. Aucune version ne sera remplacée automatiquement.
            </Text>
          </SectionCard>
        </>
      )}

      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
