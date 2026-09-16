import { Text } from "react-native";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  BottomSheet,
} from "@/components/ui";
import { useUiStore } from "@/store/ui";
export default function MoreScreen() {
  const visible = useUiStore((state) => state.aboutVisible);
  const setVisible = useUiStore((state) => state.setAboutVisible);
  return (
    <AppScreen>
      <AppHeader title="Plus" subtitle="Votre espace Fruits & Légumes." />
      <SectionCard title="Votre application">
        <Text className="text-base leading-6 text-muted">
          Retrouvez ici les informations et, prochainement, les réglages de
          votre rayon.
        </Text>
        <SecondaryButton
          label="À propos de l’application"
          onPress={() => setVisible(true)}
        />
      </SectionCard>
      <BottomSheet
        visible={visible}
        title="Fruits & Légumes"
        onClose={() => setVisible(false)}
      >
        <Text className="text-base leading-7 text-muted">
          Votre copilote de rayon, pour suivre les résultats et préparer vos
          actions.
        </Text>
        <Text className="text-base leading-7 text-muted">
          Version de développement 0.1.0. Les fonctionnalités métier sont en
          cours de construction.
        </Text>
      </BottomSheet>
    </AppScreen>
  );
}
