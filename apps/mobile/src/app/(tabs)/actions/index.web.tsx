import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
import { router } from "expo-router";
export default function ActionsWeb() {
  return (
    <AppScreen>
      <AppHeader title="Imports" />
      <InlineAlert
        title="Application mobile"
        message="Les documents et imports enregistrés restent disponibles dans la base locale de votre téléphone."
      />
      <SecondaryButton
        label="Magasin et réglages"
        onPress={() => router.push("/settings")}
      />
    </AppScreen>
  );
}
