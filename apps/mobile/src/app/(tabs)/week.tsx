import { AppScreen, AppHeader, EmptyState } from "@/components/ui";
export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Ma semaine"
        subtitle="Préparer les temps forts du rayon."
      />
      <EmptyState
        title="Aucune opération disponible"
        message="Vos opérations commerciales et leurs échéances apparaîtront ici une fois le plan de la semaine disponible."
        icon="calendar-outline"
      />
    </AppScreen>
  );
}
