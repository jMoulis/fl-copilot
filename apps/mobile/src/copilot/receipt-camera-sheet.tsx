import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MAX_RECEIPT_VIEWS } from "@fl-copilot/domain";
import { PrimaryButton, SecondaryButton, InlineAlert } from "../components/ui";
import { colors } from "../design/tokens";
import { ReceiptPhotoOrder } from "./receipt-photo-order";
import type { ReceiptPhotoSelection } from "./receipt-photo-intake";
import type { ReceiptCameraSession } from "./receipt-camera-session";

/** Loaded only after the native module was checked and the user chose the camera. */
export default function ReceiptCameraSheet({
  session,
  onSaved,
  onCancel,
}: {
  session: ReceiptCameraSession;
  onSaved(result: ReceiptPhotoSelection): void;
  onCancel(): void;
}) {
  const camera = useRef<CameraView>(null),
    mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(() => session.snapshot());
  const [permission, requestPermission, refreshPermission] =
    useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [ready, setReady] = useState(false),
    [flash, setFlash] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (state) => {
      session.interruptCapture();
      setReady(false);
      setActive(state === "active");
      setSnapshot(session.snapshot());
      if (state === "active")
        void refreshPermission().catch(() => {
          if (mounted.current)
            setError("L’autorisation de la caméra n’a pas pu être vérifiée.");
        });
    });
    return () => {
      mounted.current = false;
      session.interruptCapture();
      listener.remove();
    };
  }, [session, refreshPermission]);
  const edit = (work: () => void) => {
    setError(undefined);
    try {
      work();
      setReady(false);
      setSnapshot(session.snapshot());
    } catch {
      setError(
        "Cette vue n’a pas pu être modifiée. Vos photos restent dans cette fenêtre.",
      );
    }
  };
  const take = async () => {
    if (!camera.current || !ready || !active || !permission?.granted) return;
    setError(undefined);
    const work = session.take(async () => {
      const photo = await camera.current!.takePictureAsync({
        quality: 1,
        exif: false,
        base64: false,
        skipProcessing: false,
      });
      return {
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        format: photo.format,
      };
    });
    setSnapshot(session.snapshot());
    try {
      await work;
    } catch {
      if (mounted.current)
        setError(
          "La capture n’a pas abouti. Les vues déjà prises restent dans cette fenêtre ; vous pouvez réessayer.",
        );
    } finally {
      if (mounted.current) setSnapshot(session.snapshot());
    }
  };
  const save = async () => {
    setError(undefined);
    try {
      const work = session.save();
      setSnapshot(session.snapshot());
      const result = await work;
      if (mounted.current) onSaved(result);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      if (mounted.current)
        setError(
          code === "COPILOT_RECEIPT_PHOTO_SIZE_LIMIT"
            ? "Une photo dépasse 20 Mio. Reprenez cette vue avant de joindre le ticket."
            : code === "COPILOT_RECEIPT_GROUP_SIZE_LIMIT"
              ? "Les vues dépassent 48 Mio au total. Retirez ou reprenez une vue avant de joindre le ticket."
              : "Le ticket n’a pas pu être joint. Vos photos restent dans cette fenêtre. Réessayez avant de quitter.",
        );
    } finally {
      if (mounted.current) setSnapshot(session.snapshot());
    }
  };
  const cancel = () => {
    if (!session.snapshot().saving) onCancel();
  };
  const cameraStage = snapshot.stage === "CAMERA";
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View className="gap-2 px-5 py-3">
          <Text
            accessibilityRole="header"
            className="text-2xl font-semibold text-ink"
          >
            Photographier un ticket
          </Text>
          <Text className="text-sm text-muted">
            {snapshot.views.length} / {MAX_RECEIPT_VIEWS} vues · Un seul ticket
          </Text>
        </View>
        {cameraStage ? (
          <>
            {!permission ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color={colors.forest} />
              </View>
            ) : !permission.granted ? (
              <View className="flex-1 gap-4 p-5">
                <InlineAlert
                  title="Autoriser l’appareil photo"
                  message={
                    permission.canAskAgain
                      ? "Autorisez la caméra pour photographier votre ticket."
                      : "L’accès a été refusé. Vous pouvez l’autoriser dans les réglages de l’appareil."
                  }
                />
                <PrimaryButton
                  label={
                    permission.canAskAgain
                      ? "Autoriser l’appareil photo"
                      : "Ouvrir les réglages"
                  }
                  onPress={() => {
                    void (
                      permission.canAskAgain
                        ? requestPermission()
                        : Linking.openSettings()
                    ).catch(() => {
                      if (mounted.current)
                        setError(
                          "Les réglages de la caméra n’ont pas pu être ouverts.",
                        );
                    });
                  }}
                />
              </View>
            ) : active ? (
              <View style={{ flex: 1, backgroundColor: "#111" }}>
                <CameraView
                  ref={camera}
                  style={{ flex: 1 }}
                  facing="back"
                  mode="picture"
                  flash={flash ? "on" : "off"}
                  onCameraReady={() => setReady(true)}
                  onMountError={() => {
                    setReady(false);
                    setError(
                      "La caméra n’a pas pu démarrer. Vos vues déjà prises restent disponibles.",
                    );
                  }}
                />
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: "12%",
                    bottom: "12%",
                    left: "12%",
                    right: "12%",
                    borderWidth: 2,
                    borderColor: "white",
                    borderRadius: 16,
                  }}
                />
              </View>
            ) : (
              <View className="flex-1 items-center justify-center p-5">
                <Text className="text-base text-muted">
                  La caméra reprendra au retour dans l’application.
                </Text>
              </View>
            )}
            <View className="gap-3 p-5">
              <Text className="text-sm text-muted">
                Cadrez le texte au plus près. Pour un ticket long, ajoutez les
                vues du haut vers le bas avec un léger recouvrement, puis
                photographiez le bas du ticket.
              </Text>
              <PrimaryButton
                label="Prendre la photo"
                disabled={
                  !ready || !active || !permission?.granted || snapshot.busy
                }
                loading={snapshot.capturing}
                onPress={() => void take()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  flash ? "Désactiver le flash" : "Activer le flash"
                }
                disabled={snapshot.busy}
                onPress={() => setFlash((value) => !value)}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text className="font-semibold text-forest">
                  {flash ? "Désactiver le flash" : "Activer le flash"}
                </Text>
              </Pressable>
              {snapshot.views.length ? (
                <SecondaryButton
                  label="Revenir aux vues"
                  disabled={snapshot.busy}
                  onPress={() => edit(() => session.review())}
                />
              ) : null}
            </View>
          </>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text className="text-base text-muted">
              Vérifiez l’ordre et la lisibilité. Joindre ce ticket conservera
              vos photos dans la conversation ; la casse restera à valider.
            </Text>
            <ReceiptPhotoOrder
              assets={snapshot.views}
              disabled={snapshot.busy || snapshot.saved}
              onMove={(index, delta) => edit(() => session.move(index, delta))}
              onRemove={(index) => edit(() => session.remove(index))}
              onRetake={(index) => edit(() => session.retake(index))}
            />
            <SecondaryButton
              label="Ajouter une vue du même ticket"
              disabled={
                snapshot.busy ||
                snapshot.saved ||
                snapshot.views.length >= MAX_RECEIPT_VIEWS
              }
              onPress={() => edit(() => session.addView())}
            />
            <PrimaryButton
              label="Joindre ce ticket"
              disabled={snapshot.busy || snapshot.saved}
              loading={snapshot.saving}
              onPress={() => void save()}
            />
          </ScrollView>
        )}
        <View className="gap-2 px-5 pb-3">
          {error ? (
            <Text accessibilityRole="alert" className="text-sm text-danger">
              {error}
            </Text>
          ) : null}
          <SecondaryButton
            label="Annuler"
            disabled={snapshot.saving}
            onPress={cancel}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
