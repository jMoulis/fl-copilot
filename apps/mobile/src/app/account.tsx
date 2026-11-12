import Constants from "expo-constants";
import { Alert, Text } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  SectionCard,
  SecondaryButton,
} from "../components/ui";
export default function AccountScreen() {
  const { status, session, logout } = useAuth();
  if (status === "loading") return null;
  if (status !== "authenticated") return <Redirect href="/login" />;
  return (
    <AppScreen>
      <AppHeader title="Compte et application" />
      <SecondaryButton
        label="Retour"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/settings")
        }
      />
      <SectionCard title="Compte connecté">
        <Text className="text-ink">
          {session?.user.email ?? "Session locale"}
        </Text>
      </SectionCard>
      <SectionCard title="FL Copilot">
        <Text className="text-ink">
          Version {Constants.expoConfig?.version ?? "non renseignée"}
          {Constants.expoConfig?.ios?.buildNumber
            ? ` (${Constants.expoConfig.ios.buildNumber})`
            : ""}
        </Text>
        <Text className="text-muted">
          Ton copilote de rayon pour suivre les résultats et préparer les
          actions commerciales.
        </Text>
      </SectionCard>
      <SecondaryButton
        label="Se déconnecter"
        onPress={() =>
          Alert.alert(
            "Se déconnecter ?",
            "Fermer ta session sur cet appareil ?",
            [
              { text: "Annuler", style: "cancel" },
              {
                text: "Se déconnecter",
                style: "destructive",
                onPress: () => void logout(),
              },
            ],
          )
        }
      />
    </AppScreen>
  );
}
