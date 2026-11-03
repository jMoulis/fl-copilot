import { router } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";
import { EmailInbox } from "@/intake/email-inbox";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";

export default function StoreEmailScreen() {
  const { session } = useAuth();
  const { emailIntake, lastSyncedAt } = useSync();
  const store = session?.stores[0];
  if (!store || store.role !== "MANAGER" || !emailIntake)
    return (
      <AppScreen>
        <AppHeader title="Documents par email" />
        <InlineAlert
          title="Réception indisponible"
          message="Connectez-vous avec les droits de gestion du magasin pour retrouver sa réception."
        />
        <SecondaryButton
          label="Retour aux actions"
          onPress={() => router.back()}
        />
      </AppScreen>
    );
  return (
    <EmailInbox
      key={`${store.storeId}/${session.user.id}`}
      inbox={emailIntake}
      conversationId={store.storeId}
      initialSender={session.user.email}
      revision={lastSyncedAt}
      onClose={() => router.back()}
      onOpenSync={(id) =>
        id
          ? router.push({ pathname: "/sync-conflict/[id]", params: { id } })
          : router.push("/sync-status")
      }
    />
  );
}
