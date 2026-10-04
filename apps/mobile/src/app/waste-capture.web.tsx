import { useRouter } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";

export default function WasteCaptureWebScreen() {
  const router = useRouter();
  return (
    <AppScreen>
      <AppHeader
        title="Capture sur mobile"
        subtitle="La photographie d’un ticket utilise la caméra native de l’appareil."
      />
      <InlineAlert
        title="Fonction native"
        message="Ouvrez l’application iOS ou Android pour cadrer et conserver un ticket de casse hors ligne."
      />
      <SecondaryButton
        label="Retour à Casse"
        onPress={() => router.replace("/(tabs)/waste")}
      />
    </AppScreen>
  );
}
