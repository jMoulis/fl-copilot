import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CameraView,
  useCameraPermissions,
  type CameraCapturedPicture,
} from "expo-camera";
import { randomUUID } from "expo-crypto";
import { Redirect, useFocusEffect, useRouter, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
import { colors } from "@/design/tokens";
import { persistWasteReceiptCapture } from "@/documents/waste-receipt-capture";
import { WasteReceiptRepository } from "@/documents/waste-receipt-repository";
import { useLocalDatabase } from "@/providers/database-provider";

type CaptureStage = "camera" | "review" | "saved";

export default function WasteCaptureScreen() {
  const router = useRouter();
  const { status, session } = useAuth();
  const database = useLocalDatabase();
  const receiptRepository = useMemo(
    () => new WasteReceiptRepository(database.sqlite),
    [database.sqlite],
  );
  const storeId = session?.stores[0]?.storeId;
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission, refreshPermission] =
    useCameraPermissions();
  const [stage, setStage] = useState<CaptureStage>("camera");
  const [photo, setPhoto] = useState<CameraCapturedPicture>();
  const [savedUri, setSavedUri] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refreshPermission();
      return () => setFocused(false);
    }, [refreshPermission]),
  );

  if (status === "loading") return null;
  if (status !== "authenticated") {
    return <Redirect href={"/login" as Href} />;
  }

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator size="large" color={colors.forest} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <AppScreen>
        <AppHeader
          title="Autoriser l’appareil photo"
          subtitle="L’appareil photo est utilisé pour lire les tickets de casse."
        />
        <InlineAlert
          title="Appareil photo désactivé"
          message={
            permission.canAskAgain
              ? "Autorisez la caméra pour cadrer et photographier le ticket entier."
              : "L’accès a été refusé. Vous pouvez l’autoriser dans les réglages de l’appareil."
          }
        />
        {permission.canAskAgain ? (
          <PrimaryButton
            label="Autoriser l’appareil photo"
            onPress={() => {
              void requestPermission();
            }}
          />
        ) : (
          <PrimaryButton
            label="Ouvrir les réglages"
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        )}
        <SecondaryButton
          label="Importer une photo"
          onPress={() => router.replace("/waste-import")}
        />
        <SecondaryButton label="Annuler" onPress={() => router.back()} />
      </AppScreen>
    );
  }

  async function takePhoto() {
    if (!camera.current || !cameraReady || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const captured = await camera.current.takePictureAsync({
        quality: 0.9,
        exif: false,
      });
      setPhoto(captured);
      setStage("review");
    } catch {
      setError("La photo n’a pas pu être prise. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPhoto() {
    if (!photo || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!storeId) throw new Error("WASTE_RECEIPT_STORE_MISSING");
      const receiptId = randomUUID();
      const saved = await persistWasteReceiptCapture({
        temporaryUri: photo.uri,
        captureId: receiptId,
      });
      await receiptRepository.createCapturedDraft({
        receiptId,
        fileId: randomUUID(),
        storeId,
        capturedAt: new Date().toISOString(),
        file: saved,
      });
      setSavedUri(saved.localUri);
      setPhoto(undefined);
      setStage("saved");
    } catch {
      setError(
        "La photo n’a pas pu être conservée sur cet appareil. Réessayez avant de quitter.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (stage === "saved") {
    return (
      <AppScreen>
        <AppHeader
          title="Ticket enregistré"
          subtitle="La photo est conservée sur cet appareil."
        />
        <View className="gap-4 rounded-3xl border border-line bg-white p-5">
          <StatusBadge status="local" />
          <Text className="text-base leading-6 text-ink">
            Le ticket reste disponible après la fermeture de l’application.
            L’analyse et la synchronisation viendront ensuite.
          </Text>
          {savedUri ? (
            <Text className="text-sm leading-5 text-muted">
              Le fichier original est enregistré dans l’espace privé de
              l’application.
            </Text>
          ) : null}
        </View>
        <PrimaryButton label="Terminer" onPress={() => router.back()} />
      </AppScreen>
    );
  }

  if (stage === "review" && photo) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.darkScreen}>
        <StatusBar style="light" />
        <View style={styles.reviewHeader}>
          <Text accessibilityRole="header" style={styles.reviewTitle}>
            Vérifier la photo
          </Text>
        </View>
        <Image
          source={{ uri: photo.uri }}
          resizeMode="contain"
          style={styles.reviewImage}
          accessibilityLabel="Photo du ticket de casse à vérifier"
        />
        <View style={styles.reviewActions}>
          {error ? (
            <Text accessibilityRole="alert" style={styles.cameraError}>
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Utiliser cette photo"
            loading={busy}
            onPress={() => {
              void confirmPhoto();
            }}
          />
          <SecondaryButton
            label="Reprendre"
            disabled={busy}
            onPress={() => {
              setPhoto(undefined);
              setCameraReady(false);
              setError(undefined);
              setStage("camera");
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Annuler la capture"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.textButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.textButtonLabel}>Annuler</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.darkScreen}>
      <StatusBar style="light" />
      {focused ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          flash={flashEnabled ? "on" : "off"}
          mode="picture"
          onCameraReady={() => setCameraReady(true)}
          onMountError={() =>
            setError("La caméra n’est pas disponible sur cet appareil.")
          }
        />
      ) : null}
      <SafeAreaView edges={["top", "bottom"]} style={styles.cameraOverlay}>
        <View style={styles.cameraTopBar}>
          <CameraAction
            label="Annuler"
            icon="close"
            onPress={() => router.back()}
          />
          <CameraAction
            label={flashEnabled ? "Désactiver le flash" : "Activer le flash"}
            icon={flashEnabled ? "flash" : "flash-off"}
            onPress={() => setFlashEnabled((value) => !value)}
          />
        </View>
        <View
          accessible
          accessibilityLabel="Guide de cadrage du ticket"
          style={styles.framingGuide}
        />
        <View style={styles.cameraBottomBar}>
          <Text style={styles.instruction}>
            Cadrez le ticket entier et évitez les reflets.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.cameraError}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prendre la photo"
            accessibilityState={{ disabled: !cameraReady || busy, busy }}
            disabled={!cameraReady || busy}
            onPress={() => {
              void takePhoto();
            }}
            style={({ pressed }) => [
              styles.shutterOuter,
              {
                opacity: !cameraReady || busy ? 0.45 : pressed ? 0.75 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function CameraAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cameraAction,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={26} color={colors.surface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  darkScreen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  cameraTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  cameraAction: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: colors.overlay,
  },
  framingGuide: {
    alignSelf: "center",
    width: "82%",
    height: "58%",
    borderWidth: 3,
    borderColor: "#FFFFFFCC",
    borderRadius: 18,
    backgroundColor: "transparent",
  },
  cameraBottomBar: {
    alignItems: "center",
    gap: 14,
    paddingBottom: 16,
  },
  instruction: {
    color: colors.surface,
    backgroundColor: colors.overlay,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  cameraError: {
    color: colors.surface,
    backgroundColor: colors.critical,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  shutterOuter: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 42,
    borderWidth: 5,
    borderColor: colors.surface,
    backgroundColor: "#FFFFFF55",
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
  },
  reviewHeader: {
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  reviewTitle: {
    color: colors.surface,
    fontSize: 24,
    fontWeight: "700",
  },
  reviewImage: {
    flex: 1,
    width: "100%",
  },
  reviewActions: {
    gap: 12,
    padding: 20,
    backgroundColor: colors.surface,
  },
  textButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  textButtonLabel: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: "600",
  },
});
