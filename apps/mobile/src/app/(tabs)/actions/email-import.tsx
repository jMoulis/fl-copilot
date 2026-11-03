import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { useAuth } from "@/auth/auth-provider";
import { MercalysImportScreen } from "@/documents/mercalys-import-screen";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";

export default function EmailMercalysResultScreen() {
  const { session } = useAuth();
  const { batchId } = useLocalSearchParams<{ batchId?: string | string[] }>();
  const target = z.uuid().safeParse(batchId);
  const store = session?.stores[0];
  if (!store || store.role !== "MANAGER" || !target.success)
    return (
      <AppScreen>
        <AppHeader title="Import Mercalys" />
        <InlineAlert
          title="Import indisponible"
          message="Revenez aux documents reçus pour ouvrir cet import."
        />
        <SecondaryButton
          label="Retour aux documents reçus"
          onPress={() => router.back()}
        />
      </AppScreen>
    );
  return (
    <MercalysImportScreen
      key={`${store.storeId}/${session.user.id}/${target.data}`}
      initialBatchId={target.data}
      closeLabel="Retour aux documents reçus"
      onClose={() => router.back()}
    />
  );
}
