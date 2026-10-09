import { useState } from "react";
import { Text } from "react-native";
import { router, type Href } from "expo-router";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  BottomSheet,
  SyncState,
  MenuRow,
} from "@/components/ui";
import { useUiStore } from "@/store/ui";
import { useAuth } from "@/auth/auth-provider";
import { getAppEnvironment } from "@/config/environment";
import { sendMobileObservabilityTest } from "@/observability/sentry";
import { useSync } from "@/sync/sync-provider";

export default function MoreScreen() {
  const visible = useUiStore((state) => state.aboutVisible);
  const setVisible = useUiStore((state) => state.setAboutVisible);
  const { session, logout } = useAuth();
  const { status: syncStatus, pendingCount } = useSync();
  const [monitoringStatus, setMonitoringStatus] = useState<string>();
  const canTestMonitoring = getAppEnvironment() !== "production";

  return (
    <AppScreen>
      <AppHeader
        title="Plus"
        subtitle="Données du rayon, synchronisation et réglages."
      />

      <SectionCard
        title="Données du rayon"
        description="Gérez les sources qui alimentent vos analyses."
      >
        <MenuRow
          title="Produits"
          description="Référentiel, identifiants et alias"
          icon="leaf-outline"
          onPress={() => router.push("/(tabs)/products" as Href)}
        />
        <MenuRow
          title="Imports Mercalys"
          description="Ventes et casse à vérifier puis publier"
          icon="document-text-outline"
          onPress={() => router.push("/(tabs)/imports" as Href)}
        />
      </SectionCard>

      <SectionCard
        title="Synchronisation"
        description="Vos données restent disponibles hors connexion."
      >
        <SyncState
          status={syncStatus}
          onPress={() => router.push("/(tabs)/sync" as Href)}
        />
        <Text className="text-base leading-6 text-muted">
          {pendingCount === 0
            ? "Toutes les modifications locales ont été traitées."
            : `${pendingCount} modification${pendingCount > 1 ? "s" : ""} à synchroniser.`}
        </Text>
        <MenuRow
          title="Voir la synchronisation"
          description="Activité, éléments en attente et conflits"
          icon="sync-outline"
          onPress={() => router.push("/(tabs)/sync" as Href)}
        />
      </SectionCard>

      <SectionCard title="Magasin">
        <MenuRow
          title="Mon magasin"
          description="Commune, position et zone de vacances scolaires"
          icon="storefront-outline"
          onPress={() => router.push("/store-settings")}
        />
      </SectionCard>
      <SectionCard title="Compte et application">
        <Text className="text-sm leading-5 text-muted">Compte connecté</Text>
        <Text className="text-base font-semibold text-ink">
          {session?.user.email ?? "Session locale"}
        </Text>
        <MenuRow
          title="À propos"
          description="Version et rôle de l’application"
          icon="information-circle-outline"
          onPress={() => setVisible(true)}
        />
        <SecondaryButton
          label="Se déconnecter"
          onPress={() => {
            void logout();
          }}
        />
      </SectionCard>

      {canTestMonitoring ? (
        <SectionCard
          title="Outils de développement"
          description="Ces outils sont masqués dans l’application de production."
        >
          <MenuRow
            title="Tester le suivi des erreurs"
            description="Envoyer un événement volontaire à Sentry"
            icon="bug-outline"
            onPress={() => {
              setMonitoringStatus("Envoi en cours…");
              void sendMobileObservabilityTest().then((sent) => {
                setMonitoringStatus(
                  sent
                    ? "Événement de test envoyé."
                    : "Événement non envoyé. Vérifiez la configuration Sentry.",
                );
              });
            }}
          />
          {monitoringStatus ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {monitoringStatus}
            </Text>
          ) : null}
          <MenuRow
            title="Diagnostic XLSX"
            description="Vérifier la lecture d’un fichier sur cet appareil"
            icon="grid-outline"
            onPress={() => router.push("/(tabs)/xlsx-diagnostic" as Href)}
          />
        </SectionCard>
      ) : null}

      <BottomSheet
        visible={visible}
        title="Fruits & Légumes"
        onClose={() => setVisible(false)}
      >
        <Text className="text-base leading-7 text-muted">
          Votre copilote de rayon, pour suivre les résultats et préparer vos
          actions.
        </Text>
        <Text className="text-base leading-7 text-muted">
          Version de développement 0.1.0. Les fonctionnalités métier sont en
          cours de construction.
        </Text>
      </BottomSheet>
    </AppScreen>
  );
}
