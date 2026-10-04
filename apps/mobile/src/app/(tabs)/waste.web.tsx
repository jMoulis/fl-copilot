import { AppScreen, AppHeader, EmptyState } from "@/components/ui";

export default function Screen() {
  return (
    <AppScreen>
      <AppHeader
        title="Casse"
        subtitle="Suivre les pertes, garder une trace."
      />
      <EmptyState
        title="Capture disponible sur mobile"
        message="Ouvrez l’application iOS ou Android pour photographier un ticket de casse et conserver la photo hors ligne."
        icon="camera-outline"
      />
    </AppScreen>
  );
}
