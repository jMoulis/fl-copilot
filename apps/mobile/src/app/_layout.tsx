import "../../global.css";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "@/providers/app-providers";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
} from "@/components/ui";
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
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
export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppProviders>
  );
}
