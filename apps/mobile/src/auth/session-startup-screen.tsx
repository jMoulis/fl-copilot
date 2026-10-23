import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
} from "../components/ui";

/** No operational providers or private content mount until the stored session can be read. */
export function SessionStartupScreen({
  busy,
  onRetry,
}: {
  busy: boolean;
  onRetry(): void;
}) {
  return (
    <AppScreen>
      <AppHeader title="Connexion locale indisponible" />
      <InlineAlert
        title="Vos données sont conservées"
        message="Les accès enregistrés sur cet appareil ne peuvent pas être vérifiés pour le moment. Réessayez sans supprimer l’application. Vos données locales et les modifications en attente restent conservées."
      />
      <PrimaryButton
        label={busy ? "Vérification des accès…" : "Réessayer"}
        loading={busy}
        disabled={busy}
        onPress={onRetry}
      />
    </AppScreen>
  );
}
