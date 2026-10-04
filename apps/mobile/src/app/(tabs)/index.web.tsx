import { AppHeader, AppScreen, EmptyState } from "@/components/ui";

export default function TodayWebPreview() {
  return (
    <AppScreen>
      <AppHeader
        title="Aujourd’hui"
        subtitle="Le tableau quotidien utilise la base SQLite de l’application native."
      />
      <EmptyState
        title="Aperçu natif requis"
        message="Ouvrez l’application iPhone pour consulter les indicateurs, les priorités et les mouvements calculés hors connexion."
        icon="phone-portrait-outline"
      />
    </AppScreen>
  );
}
