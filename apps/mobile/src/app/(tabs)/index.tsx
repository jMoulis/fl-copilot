import { router, type Href } from "expo-router";
import {
  AppScreen,
  AppHeader,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Aujourd’hui"
        subtitle="Un regard clair sur votre rayon."
      />
      <EmptyState
        title="Aucune journée analysable"
        message="Importez les ventes Mercalys pour afficher vos indicateurs et vos premières priorités."
        icon="analytics-outline"
      >
        <PrimaryButton
          label="Importer les ventes"
          onPress={() => router.push("/(tabs)/imports" as Href)}
        />
        <SecondaryButton
          label="Voir les produits"
          onPress={() => router.push("/(tabs)/products" as Href)}
        />
      </EmptyState>
    </AppScreen>
  );
}
