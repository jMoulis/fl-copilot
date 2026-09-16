import { AppScreen, AppHeader, EmptyState } from "@/components/ui";
export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Casse"
        subtitle="Suivre les pertes, garder une trace."
      />
      <EmptyState
        title="Aucun ticket enregistré"
        message="Vos tickets et leur état de validation apparaîtront ici. La capture sera disponible dans une prochaine étape."
        icon="camera-outline"
      />
    </AppScreen>
  );
}
