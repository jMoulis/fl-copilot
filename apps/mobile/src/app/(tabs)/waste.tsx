import { useRouter } from "expo-router";
import {
  AppScreen,
  AppHeader,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

export default function Screen() {
  const router = useRouter();
  return (
    <AppScreen>
      <AppHeader
        title="Casse"
        subtitle="Suivre les pertes, garder une trace."
      />
      <EmptyState
        title="Aucun ticket enregistré"
        message="Photographiez un ticket de casse. La photo est conservée sur cet appareil, même sans connexion."
        icon="camera-outline"
      >
        <PrimaryButton
          label="Prendre un ticket en photo"
          onPress={() => router.push("/waste-capture")}
        />
        <SecondaryButton
          label="Importer une photo"
          onPress={() => router.push("/waste-import")}
        />
      </EmptyState>
    </AppScreen>
  );
}
