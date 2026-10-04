import "../../global.css";
import { useEffect } from "react";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "@/providers/app-providers";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
} from "@/components/ui";
import {
  captureScreenError,
  initializeObservability,
  withSentry,
} from "@/observability/sentry";

initializeObservability();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureScreenError(error, "root");
  }, [error]);

  return (
    <AppProviders>
      <AppScreen>
        <AppHeader title="Un problème est survenu" />
        <InlineAlert
          title="Écran indisponible"
          message="Réessayez d’ouvrir cet écran."
        />
        <PrimaryButton
          label="Réessayer"
          onPress={() => {
            void retry();
          }}
        />
      </AppScreen>
    </AppProviders>
  );
}
function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="waste-capture" />
      </Stack>
    </AppProviders>
  );
}

export default withSentry(RootLayout);
