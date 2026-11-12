import { router } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { MercalysImportScreen } from "@/documents/mercalys-import-screen";
export default function MercalysImportsScreen() {
  const { session } = useAuth();
  return (
    <MercalysImportScreen
      key={`${session?.stores[0]?.storeId}:${session?.user.id}`}
      closeLabel="Retour"
      onClose={() =>
        router.canGoBack() ? router.back() : router.replace("/(tabs)/actions")
      }
    />
  );
}
