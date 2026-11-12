import { useState } from "react";
import { Text } from "react-native";
import { router, type Href } from "expo-router";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  MenuRow,
} from "@/components/ui";
import { DetailsDisclosure } from "@/components/dashboard";
import { getAppEnvironment } from "@/config/environment";
import { sendMobileObservabilityTest } from "@/observability/sentry";
export default function SettingsScreen() {
  const [monitoringStatus, setMonitoringStatus] = useState<string>();
  return (
    <AppScreen>
      <AppHeader title="Réglages" />
      <SecondaryButton
        label="Retour"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/today")
        }
      />
      <SectionCard title="Configurer mon magasin">
        <MenuRow
          title="Magasin et implantation"
          description="Localisation, mobilier, TG et circulation"
          icon="storefront-outline"
          onPress={() => router.push("/store-settings")}
        />
        <MenuRow
          title="Mémoire du copilote"
          description="Pratiques confirmées, correction et oubli"
          icon="bookmark-outline"
          onPress={() => router.push("/copilot-memory")}
        />
        <MenuRow
          title="Besoins clients"
          description="Usages et associations de produits"
          icon="people-outline"
          onPress={() => router.push("/need-units")}
        />
        <MenuRow
          title="Réception email"
          description="Adresse du magasin et expéditeurs autorisés"
          icon="mail-outline"
          onPress={() => router.push("/email-settings")}
        />
      </SectionCard>
      <SectionCard title="Gérer l’application">
        <MenuRow
          title="Notifications"
          description="Copilote, documents et rappels"
          icon="notifications-outline"
          onPress={() => router.push("/reminder-settings")}
        />
        <MenuRow
          title="Synchronisation"
          description="Envois, conflits et copies locales"
          icon="sync-outline"
          onPress={() => router.push("/sync-center")}
        />
        <MenuRow
          title="Compte et application"
          description="Compte connecté, version et déconnexion"
          icon="person-circle-outline"
          onPress={() => router.push("/account")}
        />
      </SectionCard>
      {getAppEnvironment() !== "production" ? (
        <DetailsDisclosure title="Outils de développement">
          <MenuRow
            title="Tester le suivi des erreurs"
            description="Envoyer un événement volontaire à Sentry"
            icon="bug-outline"
            onPress={() => {
              setMonitoringStatus("Envoi en cours…");
              void sendMobileObservabilityTest().then((sent) =>
                setMonitoringStatus(
                  sent
                    ? "Événement de test envoyé."
                    : "Événement non envoyé. Vérifiez la configuration Sentry.",
                ),
              );
            }}
          />
          {monitoringStatus ? (
            <Text accessibilityLiveRegion="polite" className="text-muted">
              {monitoringStatus}
            </Text>
          ) : null}
          <MenuRow
            title="Diagnostic XLSX"
            description="Vérifier la lecture sur cet appareil"
            icon="grid-outline"
            onPress={() => router.push("/(tabs)/xlsx-diagnostic" as Href)}
          />
        </DetailsDisclosure>
      ) : null}
    </AppScreen>
  );
}
