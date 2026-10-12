import { router } from "expo-router";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
export default function CopilotWebScreen() {
  return (
    <AppScreen>
      <AppHeader title="Copilote" />
      <InlineAlert
        title="Application mobile"
        message="Vos conversations sont disponibles dans l’application mobile."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
