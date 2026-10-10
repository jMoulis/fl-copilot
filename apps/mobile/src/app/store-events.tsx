import { router, useLocalSearchParams, type Href } from "expo-router";
import { AppScreen, AppHeader, SecondaryButton } from "@/components/ui";
import { StoreEventsView } from "@/needs/store-events-view";
export default function StoreEventsScreen() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  return (
    <AppScreen>
      <AppHeader
        title="Signalements magasin"
        subtitle="Observations conservées sur cet appareil et synchronisées entre les appareils du magasin."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      <SecondaryButton
        label="Signaler une observation"
        onPress={() =>
          router.push({
            pathname: "/store-event",
            params: { ...(productId ? { productId } : {}) },
          } as Href)
        }
      />
      <StoreEventsView productId={productId} />
    </AppScreen>
  );
}
