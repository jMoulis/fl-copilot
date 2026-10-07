import { AppScreen, AppHeader, EmptyState } from "@/components/ui";
export default function WeekScreen() {
  return (
    <AppScreen>
      <AppHeader
        title="Ma semaine"
        subtitle="Préparer les temps forts du rayon."
      />
      <EmptyState
        title="Import disponible sur mobile"
        message="Ouvrez l’application iOS ou Android pour importer un PDF commercial et le conserver hors connexion."
        icon="document-outline"
      />
    </AppScreen>
  );
}
