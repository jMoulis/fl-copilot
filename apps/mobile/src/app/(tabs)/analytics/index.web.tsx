import { AppHeader, AppScreen, InlineAlert } from "@/components/ui";
export default function WebAnalytics() {
  return (
    <AppScreen>
      <AppHeader title="Analyses" />
      <InlineAlert
        title="Données sur votre appareil"
        message="L’exploration des chiffres utilise la base locale de l’application mobile."
      />
    </AppScreen>
  );
}
