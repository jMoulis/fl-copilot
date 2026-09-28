import { Text } from "react-native";
import { AppHeader, AppScreen, SectionCard } from "@/components/ui";

export default function MercalysImportsWebScreen() {
  return (
    <AppScreen>
      <AppHeader
        title="Imports Mercalys"
        subtitle="La validation XLSX s’exécute localement dans l’application native."
      />
      <SectionCard title="Application native requise">
        <Text className="text-base leading-6 text-muted">
          Ouvrez ce parcours depuis le build iOS ou Android pour choisir et
          vérifier un export Mercalys stocké sur l’appareil.
        </Text>
      </SectionCard>
    </AppScreen>
  );
}
