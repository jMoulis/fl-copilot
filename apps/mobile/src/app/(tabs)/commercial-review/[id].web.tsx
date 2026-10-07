import { router, type Href } from "expo-router";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
export default function CommercialReviewWeb() {
  return (
    <AppScreen>
      <AppHeader title="Examiner le document" />
      <InlineAlert
        title="Examen sur l’application native"
        message="Les extraits et vos choix sont conservés sur votre téléphone pour rester accessibles hors connexion."
      />
      <SecondaryButton
        label="Retour à Ma semaine"
        onPress={() => router.replace("/week" as Href)}
      />
    </AppScreen>
  );
}
