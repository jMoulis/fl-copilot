import { AppScreen, AppHeader, EmptyState } from "@/components/ui";
export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Analyses"
        subtitle="Comprendre les résultats du rayon."
      />
      <EmptyState
        title="Pas encore de données à analyser"
        message="Les analyses seront disponibles à partir de vos données de ventes et de casse."
        icon="bar-chart-outline"
      />
    </AppScreen>
  );
}
