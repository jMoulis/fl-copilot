import { useState } from "react";
import { Text } from "react-native";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  BottomSheet,
} from "@/components/ui";
import { useUiStore } from "@/store/ui";
import { useAuth } from "@/auth/auth-provider";
import { getAppEnvironment } from "@/config/environment";
import { sendMobileObservabilityTest } from "@/observability/sentry";
export default function MoreScreen() {
  const visible = useUiStore((state) => state.aboutVisible);
  const setVisible = useUiStore((state) => state.setAboutVisible);
  const { session, logout } = useAuth();
  const [monitoringStatus, setMonitoringStatus] = useState<string>();
  const canTestMonitoring = getAppEnvironment() !== "production";
  return (
    <AppScreen>
      <AppHeader title="Plus" subtitle="Votre espace Fruits & Légumes." />
      <SectionCard title="Votre application">
        <Text className="text-base leading-6 text-muted">
          Retrouvez ici les informations et, prochainement, les réglages de
          votre rayon.
        </Text>
        <SecondaryButton
          label="À propos de l’application"
          onPress={() => setVisible(true)}
        />
      </SectionCard>
      <SectionCard title="Votre session">
        <Text className="text-base leading-6 text-muted">
          {session?.user.email ?? "Session locale"}
        </Text>
        <SecondaryButton
          label="Se déconnecter"
          onPress={() => {
            void logout();
          }}
        />
      </SectionCard>
      {canTestMonitoring ? (
        <SectionCard title="Diagnostic de développement">
          <Text className="text-base leading-6 text-muted">
            Envoyez une erreur volontaire pour vérifier le projet Sentry mobile.
          </Text>
          <SecondaryButton
            label="Tester le suivi des erreurs"
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
