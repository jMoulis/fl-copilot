import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
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
  const { receiptId } = useLocalSearchParams<{ receiptId?: string }>();
  const received = z.uuid().safeParse(receiptId);
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
      refreshKey={received.success ? received.data : undefined}
      onClose={() => router.back()}
      onOpenMercalys={(batchId) =>
        router.push({ pathname: "/actions/email-import", params: { batchId } })
      }
      onOpenSync={(id) =>
        id
          ? router.push({ pathname: "/sync-conflict/[id]", params: { id } })
          : router.push("/sync-status")
      }
    />
  );
}
