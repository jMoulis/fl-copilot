import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { IconButton } from "../components/dashboard";
import { BottomSheet, InlineAlert } from "../components/ui";
import { ProductMasterRepository } from "./product-master-repository";
import { lookupProductBarcode } from "./product-barcode-lookup";

/** Camera module is loaded only after the user opens the scanner. */
export function ProductBarcodeSearch({ onOpen }: { onOpen(id: string): void }) {
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId;
  const ownerId = session?.user.id;
  const { sqlite } = useLocalDatabase();
  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const [Sheet, setSheet] =
    useState<typeof import("./product-barcode-camera").default>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const opening = useRef(false);
  const close = useCallback(() => {
    generation.current++;
    opening.current = false;
    setSheet(undefined);
    setError(undefined);
    setLoading(false);
  }, []);
  useEffect(() => close(), [close, storeId, ownerId, sqlite]);
  useFocusEffect(useCallback(() => () => close(), [close]));

  const open = async () => {
    if (opening.current || !storeId) return;
    opening.current = true;
    const ticket = ++generation.current;
    Keyboard.dismiss();
    setLoading(true);
    try {
      if (Platform.OS === "web" || !requireOptionalNativeModule("ExpoCamera"))
        throw Error("CAMERA_UNAVAILABLE");
      const camera = await import("./product-barcode-camera");
      if (ticket === generation.current) setSheet(() => camera.default);
    } catch {
      if (ticket === generation.current)
        setError(
          "Le scan n’est pas disponible sur cet appareil. Tu peux rechercher le code dans la liste des produits.",
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  };
  return (
    <>
      <IconButton
        label="Scanner un gencode"
        icon="barcode-outline"
        disabled={!storeId || loading}
        onPress={() => void open()}
      />
      {Sheet && storeId ? (
        <Sheet
          lookup={(code) => lookupProductBarcode(repository, storeId, code)}
          onClose={close}
          onFound={(id) => {
            close();
            onOpen(id);
          }}
        />
      ) : null}
      <BottomSheet
        visible={Boolean(error)}
        title="Scanner un gencode"
        onClose={close}
      >
        {error ? (
          <InlineAlert title="Caméra indisponible" message={error} />
        ) : null}
      </BottomSheet>
    </>
  );
}
