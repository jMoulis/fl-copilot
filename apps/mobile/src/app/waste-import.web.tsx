import { useRouter } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";

export default function WasteImportWebScreen() {
  const router = useRouter();
  return (
    <AppScreen>
      <AppHeader
        title="Import sur mobile"
        subtitle="La sélection et la conservation privée d’une photo sont disponibles dans l’application native."
      />
      <InlineAlert
        title="Fonction native"
        message="Ouvrez l’application iOS ou Android pour importer une photo de ticket de casse."
      />
      <SecondaryButton
        label="Retour à Casse"
        onPress={() => router.replace("/(tabs)/waste")}
      />
    </AppScreen>
  );
}
