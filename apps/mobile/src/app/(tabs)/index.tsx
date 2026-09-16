import { AppScreen, AppHeader, EmptyState } from "@/components/ui";
export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Aujourd’hui"
        subtitle="Un regard clair sur votre rayon."
      />
      <EmptyState
        title="Votre rayon prend ses repères"
        message="Vos ventes, votre marge et vos priorités apparaîtront ici lorsque vos premières données seront disponibles."
        icon="leaf-outline"
      />
    </AppScreen>
  );
}
