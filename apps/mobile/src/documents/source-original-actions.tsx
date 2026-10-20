import { useState } from "react";
import { Image, Text, View } from "react-native";
import { BottomSheet, InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import type {
  SourceOriginalProof,
  SourceOriginalState,
} from "./source-original-transfer";
export function sourceOriginalMessage(code?: string | null) {
  if (code === "SOURCE_ORIGINAL_LOCAL_PENDING")
    return "Un original local n’est pas encore envoyé. Conservez-le sur cet appareil et reprenez son envoi avant de demander une autre copie.";
  if (
    [
      "SOURCE_ORIGINAL_BINDING_INVALID",
      "SOURCE_ORIGINAL_FILE_INVALID",
      "SOURCE_ORIGINAL_INVALID",
      "SOURCE_ORIGINAL_LOCAL_CHANGED",
      "SOURCE_ORIGINAL_CHANGED",
    ].includes(code ?? "")
  )
    return "Le fichier ou ses références ne correspondent plus à l’original attendu. Les copies existantes sont conservées ; aucune donnée n’a été remplacée.";
  if (code === "SOURCE_ORIGINAL_UNAVAILABLE")
    return "L’original n’est pas disponible pour ce magasin ou ce compte. Les données métier déjà enregistrées restent consultables.";
  if (code === "SOURCE_ORIGINAL_SHARE_UNAVAILABLE")
    return "Le partage du fichier n’est pas disponible dans cette version de l’application. La copie reste conservée et les photos restent consultables ici.";
  return "La récupération n’a pas abouti. Vos originaux et vos corrections restent conservés. Vous pouvez réessayer.";
}
/** Presentation only: renders supplied SQLite state, never reads bytes or starts a download. */
export function SourceOriginalActions({
  state,
  proof,
  busy,
  open,
  error,
  offline,
  label,
  disabled = false,
  onOpen,
  onCancel,
  onClose,
  onShare,
}: {
  state: SourceOriginalState | null;
  proof: SourceOriginalProof | null;
  busy: boolean;
  open: boolean;
  error?: string;
  offline: boolean;
  label?: string;
  disabled?: boolean;
  onOpen(): void;
  onCancel(): void;
  onClose(): void;
  onShare(viewIndex?: number): void;
}) {
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [selection, setSelection] = useState({ source: "", index: 0 });
  const waiting = ["PENDING", "RUNNING", "RETRY"].includes(
    state?.job?.status ?? "",
  );
  const failed = state?.job?.status === "FAILED";
  const photos =
    proof?.views?.map((view) => view.localUri) ??
    (proof && state?.mimeType?.startsWith("image/") ? [proof.localUri] : []);
  const photoIndex = Math.max(
    0,
    Math.min(
      selection.source === proof?.localUri ? selection.index : 0,
      photos.length - 1,
    ),
  );
  return (
    <View style={{ gap: 10 }}>
      <SecondaryButton
        label={
          busy
            ? "Vérification de l’original…"
            : waiting && !state?.retained
              ? state?.job?.status === "RUNNING"
                ? "Récupération en cours…"
                : "Récupération en attente"
              : failed
                ? "Réessayer la récupération"
                : (label ?? "Consulter l’original")
        }
        disabled={disabled || busy || (waiting && !state?.retained)}
        onPress={onOpen}
      />
      {waiting ? (
        <>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}
          >
            {offline
              ? "La demande est conservée. Le téléchargement reprendra au retour du réseau."
              : state?.job?.status === "RETRY"
                ? "La demande est conservée ; une nouvelle tentative sera faite automatiquement."
                : "L’original sera conservé sur cet appareil après vérification."}
          </Text>
          <SecondaryButton
            label="Annuler la récupération"
            disabled={busy}
            onPress={onCancel}
          />
        </>
      ) : null}
      {(error || failed) && !open ? (
        <InlineAlert
          title="Consultation de l’original"
          message={error ?? sourceOriginalMessage(state?.job?.lastError)}
        />
      ) : null}
      <BottomSheet
        visible={open}
        title={state?.filename ?? "Fichier original"}
        swipeToClose
        onClose={onClose}
      >
        {error ? (
          <InlineAlert title="Consultation de l’original" message={error} />
        ) : null}
        {photos.slice(photoIndex, photoIndex + 1).map((uri) => (
          <View key={uri} style={{ gap: 8 }}>
            {photos.length > 1 ? (
              <Text style={{ color: colors.muted }}>
                Vue {photoIndex + 1} sur {photos.length}
              </Text>
            ) : null}
            {failedPhotos.includes(uri) ? (
              <Text style={{ color: colors.muted }}>
                Cette vue ne peut pas être affichée ici. L’original reste
                conservé ; utilisez « Ouvrir ou partager le fichier » pour le
                consulter.
              </Text>
            ) : (
              <Image
                source={{ uri }}
                onError={() =>
                  setFailedPhotos((old) =>
                    old.includes(uri) ? old : [...old, uri],
                  )
                }
                resizeMode="contain"
                accessibilityLabel={`Photo originale, vue ${photoIndex + 1} sur ${photos.length}`}
                style={{
                  height: 400,
                  width: "100%",
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: 16,
                }}
              />
            )}
            {proof?.views ? (
              <SecondaryButton
                label={`Ouvrir ou partager la vue ${photoIndex + 1}`}
                disabled={busy}
                onPress={() => onShare(photoIndex)}
              />
            ) : null}
          </View>
        ))}
        {photos.length > 1 ? (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <SecondaryButton
                label="Vue précédente"
                disabled={busy || photoIndex === 0}
                onPress={() =>
                  setSelection({
                    source: proof!.localUri,
                    index: photoIndex - 1,
                  })
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton
                label="Vue suivante"
                disabled={busy || photoIndex === photos.length - 1}
                onPress={() =>
                  setSelection({
                    source: proof!.localUri,
                    index: photoIndex + 1,
                  })
                }
              />
            </View>
          </View>
        ) : null}
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          L’original est conservé sur cet appareil.{" "}
          {photos.length
            ? "Les corrections ne modifient pas ces photos."
            : "Ouvrez-le avec une application compatible depuis la feuille de partage."}
        </Text>
        <SecondaryButton
          label={
            proof?.views
              ? "Partager la source complète"
              : "Ouvrir ou partager le fichier"
          }
          disabled={busy || !proof}
          onPress={() => onShare()}
        />
      </BottomSheet>
    </View>
  );
}
