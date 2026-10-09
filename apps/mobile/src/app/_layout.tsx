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
        <Stack.Screen name="waste-import" />
        <Stack.Screen name="waste-receipt/[id]" />
        <Stack.Screen name="commercial-offer/[id]" />
        <Stack.Screen name="week-preparation" />
        <Stack.Screen name="commercial-plan" />
        <Stack.Screen name="store-settings" />
        <Stack.Screen name="reminder-settings" />
        <Stack.Screen name="need-units" />
        <Stack.Screen name="need-unit/[id]" />
        <Stack.Screen name="commercial-operation/[id]" />
        <Stack.Screen name="commercial-comparison" />
      </Stack>
    </AppProviders>
  );
}

export default withSentry(RootLayout);
