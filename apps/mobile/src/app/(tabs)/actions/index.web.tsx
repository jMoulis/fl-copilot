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
      <AppHeader title="Actions" />
      <InlineAlert
        title="Application mobile"
        message="Les actions enregistrées restent disponibles dans la base locale de votre téléphone."
      />
      <SecondaryButton
        label="Magasin et réglages"
        onPress={() => router.push("/more")}
      />
    </AppScreen>
  );
}
