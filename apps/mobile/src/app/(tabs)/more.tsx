import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { AppScreen, MenuRow } from "@/components/ui";
import { useAuth } from "@/auth/auth-provider";
import {
  SettingsHeader,
  SettingsIntro,
  SettingsGroup,
} from "@/components/settings-chrome";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "@/design/tokens";
import { DetailsDisclosure } from "@/components/dashboard";
import { getAppEnvironment } from "@/config/environment";
import { sendMobileObservabilityTest } from "@/observability/sentry";
export default function SettingsScreen() {
  const { session } = useAuth();
  const store = session?.stores[0];
  const [monitoringStatus, setMonitoringStatus] = useState<string>();
  return (
    <AppScreen
      header={
        <SettingsHeader
          title="Réglages"
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/today")
          }
        />
      }
    >
      <SettingsIntro
        eyebrow="À ta main"
        title={"L’essentiel,\nbien rangé."}
        description="Ton magasin et ton application, chacun à sa place."
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mon magasin. Localisation, mobilier, TG et circulation"
        onPress={() => router.push("/store-settings")}
        className="flex-row items-center gap-4 rounded-3xl bg-hero p-6"
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <View className="rounded-2xl bg-forest-strong p-3">
          <Ionicons
            name="storefront-outline"
            size={25}
            color={colors.heroInk}
            accessible={false}
          />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-lg font-semibold text-hero-ink">
            {store?.name ?? "Mon magasin"}
          </Text>
          <Text className="text-sm text-hero-muted">
            Localisation, TG et circulation
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.heroMuted}
          accessible={false}
        />
      </Pressable>
      <SettingsGroup title="Ton magasin">
        <MenuRow
          quiet
          title="Mémoire du copilote"
          description="Pratiques confirmées, correction et oubli"
          icon="bookmark-outline"
          onPress={() => router.push("/copilot-memory")}
        />
        <MenuRow
          quiet
          title="Besoins clients"
          description="Usages et associations de produits"
          icon="people-outline"
          onPress={() => router.push("/need-units")}
        />
        <MenuRow
          quiet
          title="Réception email"
          description="Adresse du magasin et expéditeurs autorisés"
          icon="mail-outline"
          onPress={() => router.push("/email-settings")}
        />
      </SettingsGroup>
      <SettingsGroup title="Ton application">
        <MenuRow
          quiet
          title="Notifications"
          description="Copilote, documents et rappels"
          icon="notifications-outline"
          onPress={() => router.push("/reminder-settings")}
        />
        <MenuRow
          quiet
          title="Synchronisation"
          description="Envois, conflits et copies locales"
          icon="sync-outline"
          onPress={() => router.push("/sync-center")}
        />
        <MenuRow
          quiet
          title="Compte et application"
          description="Compte connecté, version et déconnexion"
          icon="person-circle-outline"
          onPress={() => router.push("/account")}
        />
      </SettingsGroup>
      {getAppEnvironment() !== "production" ? (
        <DetailsDisclosure title="Outils de développement">
          <MenuRow
            quiet
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
            quiet
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
