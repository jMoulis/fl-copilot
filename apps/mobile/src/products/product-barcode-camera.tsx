import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { PrimaryButton, SecondaryButton, InlineAlert } from "../components/ui";
import { IconButton } from "../components/dashboard";
import { colors } from "../design/tokens";
import type { BarcodeLookupResult } from "./product-barcode-lookup";

export default function ProductBarcodeCamera({
  lookup,
  onFound,
  onClose,
}: {
  lookup(code: string): Promise<BarcodeLookupResult>;
  onFound(id: string): void;
  onClose(): void;
}) {
  const [permission, requestPermission, refreshPermission] =
    useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; message: string }>();
  const [cameraError, setCameraError] = useState<string>();
  const operation = useRef({
    locked: false,
    generation: 0,
    active: AppState.currentState === "active",
  });
  useEffect(() => {
    const lifecycle = operation.current;
    let mounted = true;
    lifecycle.locked = false;
    const listener = AppState.addEventListener("change", (state) => {
      operation.current.generation++;
      operation.current.locked = false;
      setBusy(false);
      operation.current.active = state === "active";
      setActive(state === "active");
      if (state === "active")
        void refreshPermission().catch(() => {
          if (mounted)
            setCameraError(
              "L’autorisation de la caméra n’a pas pu être vérifiée.",
            );
        });
    });
    return () => {
      lifecycle.generation++;
      mounted = false;
      lifecycle.locked = true;
      listener.remove();
    };
  }, [refreshPermission]);
  const close = () => {
    operation.current.generation++;
    operation.current.locked = true;
    onClose();
  };
  const scan = async (code: string) => {
    if (
      operation.current.locked ||
      !operation.current.active ||
      result ||
      cameraError
    )
      return;
    operation.current.locked = true;
    const ticket = ++operation.current.generation;
    setBusy(true);
    try {
      const found = await lookup(code);
      if (ticket !== operation.current.generation) return;
      if (found.status === "FOUND") {
        onFound(found.productId);
        return;
      }
      setResult({
        code,
        message:
          found.status === "AMBIGUOUS"
            ? "Ce code est associé à plusieurs produits. Vérifie leurs identifiants dans le catalogue."
            : found.status === "UNVALIDATED"
              ? "L’association de ce code à un produit reste à valider dans le catalogue."
              : found.status === "INVALID"
                ? "Ce format de code n’est pas pris en charge. Scanne un code EAN."
                : "Ce code n’est pas encore présent dans le catalogue de ton magasin.",
      });
    } catch {
      if (ticket === operation.current.generation)
        setResult({
          code,
          message: "La recherche locale n’a pas abouti. Tu peux réessayer.",
        });
    } finally {
      if (ticket === operation.current.generation) setBusy(false);
    }
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View className="flex-row items-center gap-3 p-5">
          <Text
            accessibilityRole="header"
            className="flex-1 text-2xl font-bold text-ink"
          >
            Scanner un gencode
          </Text>
          <IconButton label="Fermer le scanner" icon="close" onPress={close} />
        </View>
        {!permission ? (
          <ActivityIndicator color={colors.forest} />
        ) : !permission.granted ? (
          <View className="flex-1 gap-4 p-5">
            <InlineAlert
              title="Autoriser la caméra"
              message="L’appareil photo sert à lire le code-barres du produit."
            />
            <PrimaryButton
              label={
                permission.canAskAgain
                  ? "Autoriser la caméra"
                  : "Ouvrir les réglages"
              }
              onPress={() => {
                void (
                  permission.canAskAgain
                    ? requestPermission()
                    : Linking.openSettings()
                ).catch(() =>
                  setCameraError("L’accès à la caméra n’a pas pu être ouvert."),
                );
              }}
            />
          </View>
        ) : active && !cameraError && !result && !busy ? (
          <View style={{ flex: 1, backgroundColor: colors.hero }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a"],
              }}
              onBarcodeScanned={({ data }) => void scan(data)}
              onMountError={() =>
                setCameraError(
                  "La caméra n’a pas pu démarrer. Ferme le scanner puis réessaie.",
                )
              }
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: "32%",
                height: "30%",
                left: "10%",
                right: "10%",
                borderWidth: 2,
                borderColor: colors.accent,
                borderRadius: 24,
              }}
            />
          </View>
        ) : (
          <View className="flex-1 items-center justify-center px-5">
            {busy ? (
              <ActivityIndicator size="large" color={colors.forest} />
            ) : null}
            {result ? (
              <View className="gap-4">
                <Text
                  selectable
                  className="text-center text-xl font-semibold text-ink"
                >
                  {result.code}
                </Text>
                <InlineAlert
                  title="Produit non ouvert"
                  message={result.message}
                />
              </View>
            ) : null}
            {!active ? (
              <Text className="text-base text-muted">
                Le scan reprendra au retour dans l’application.
              </Text>
            ) : null}
          </View>
        )}
        <View className="gap-3 p-5">
          {cameraError ? (
            <InlineAlert title="Caméra indisponible" message={cameraError} />
          ) : null}
          {result ? (
            <PrimaryButton
              label="Scanner un autre code"
              onPress={() => {
                operation.current.generation++;
                operation.current.locked = false;
                setResult(undefined);
              }}
            />
          ) : (
            <Text className="text-center text-base text-muted">
              Cadre le code-barres pour retrouver sa fiche.
            </Text>
          )}
          {permission?.granted && !result && !cameraError ? (
            <SecondaryButton
              label={torch ? "Éteindre la lampe" : "Allumer la lampe"}
              onPress={() => setTorch((value) => !value)}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
