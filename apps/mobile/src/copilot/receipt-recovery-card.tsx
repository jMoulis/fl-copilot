import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Switch,
  View,
} from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotReceiptRecoveryController } from "./receipt-recovery-controller";
import { colors } from "../design/tokens";
const titles = {
  RETRY_PROCESSING: "Relancer le traitement du ticket",
  KEEP_BOTH: "Conserver les deux tickets",
  CONFIRM_DUPLICATE: "Marquer ce ticket comme doublon",
};
const outcomes = {
  RETRY_PROCESSING:
    "Reprise enregistrée sur cet appareil. L’envoi et l’analyse attendent le service ; leur réussite n’est pas encore confirmée.",
  KEEP_BOTH:
    "Les deux tickets sont conservés. Aucune casse n’a été publiée par cette décision.",
  CONFIRM_DUPLICATE:
    "Ce ticket est marqué comme doublon. Son original est conservé et aucune casse n’a été publiée.",
};
export function ReceiptRecoveryCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotReceiptRecoveryController;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotReceiptRecoveryController["open"]>>>(),
    [reviewed, setReviewed] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string>(),
    [imageError, setImageError] = useState(false),
    [originalLoaded, setOriginalLoaded] = useState(false),
    [candidateLoaded, setCandidateLoaded] = useState(false);
  const revision = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined),
    router = useRouter();
  useFocusEffect(
    useCallback(() => {
      const version = ++revision.current;
      setState(undefined);
      setReviewed(false);
      setSaving(false);
      setError(undefined);
      setImageError(false);
      setOriginalLoaded(false);
      setCandidateLoaded(false);
      void controller
        .open(message)
        .then((s) => {
          if (revision.current === version) setState(s);
        })
        .catch(() => {
          if (revision.current === version)
            setError(
              "La reprise ne peut pas être préparée. Synchronisez puis demandez un nouvel aperçu ; les originaux restent conservés.",
            );
        });
      return () => {
        revision.current++;
        abort.current?.abort();
      };
    }, [controller, message]),
  );
  const confirm = async () => {
    if (
      locked.current ||
      !canConfirm ||
      !reviewed ||
      imageError ||
      !imagesReady ||
      state?.status !== "READY"
    )
      return;
    const version = revision.current,
      cancellation = new AbortController();
    locked.current = true;
    abort.current = cancellation;
    setSaving(true);
    setError(undefined);
    try {
      const next = await controller.confirm(
        message,
        state.review!.basisHash,
        true,
        cancellation.signal,
      );
      if (revision.current === version) setState(next);
    } catch {
      if (revision.current === version) {
        setReviewed(false);
        setError(
          "L’état du ticket a changé ou la reprise n’a pas été enregistrée. Relisez les informations avant de confirmer.",
        );
        const next = await controller.open(message).catch(() => undefined);
        if (revision.current === version) setState(next);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (revision.current === version) setSaving(false);
    }
  };
  const action = state?.content.input.action,
    review = state?.review,
    imagesReady =
      action === "RETRY_PROCESSING" || (originalLoaded && candidateLoaded);
  const sourceLink = (id: string, label: string) => (
    <Pressable
      accessibilityRole="button"
      disabled={saving}
      style={{ minHeight: 44, padding: 10 }}
      onPress={() =>
        router.push({ pathname: "/waste-receipt/[id]", params: { id } })
      }
    >
      <Text style={{ color: colors.forest, textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        {action ? titles[action] : "Reprendre le ticket de casse"}
      </Text>
      {state ? (
        <>
          <Text>{state.content.source.filename}</Text>
          {action === "RETRY_PROCESSING" ? (
            <Text>
              La relance reprend la tâche existante. Elle peut déclencher une
              analyse IA facturée par le service configuré. Elle ne publie pas
              le ticket et ne garantit pas la disponibilité du service.
            </Text>
          ) : (
            <Text>
              Comparez les deux originaux. Les conserver peut conduire à deux
              publications distinctes si vous les validez ensuite. Marquer un
              doublon ne supprime pas sa photo.
            </Text>
          )}
          {review ? (
            <>
              {review.localFileUri && action !== "RETRY_PROCESSING" ? (
                <Image
                  source={{ uri: review.localFileUri }}
                  style={{ height: 180, width: "100%" }}
                  resizeMode="contain"
                  accessibilityLabel="Original du ticket à examiner"
                  onLoad={() => setOriginalLoaded(true)}
                  onError={() => setImageError(true)}
                />
              ) : null}
              {sourceLink(
                review.current.receipt.id,
                "Voir le ticket et son original",
              )}
              {review.candidate ? (
                <>
                  <Text style={{ fontWeight: "600" }}>
                    Ticket déjà enregistré
                  </Text>
                  {review.candidate.localFileUri ? (
                    <Image
                      source={{ uri: review.candidate.localFileUri }}
                      style={{ height: 180, width: "100%" }}
                      resizeMode="contain"
                      accessibilityLabel="Original du doublon possible"
                      onLoad={() => setCandidateLoaded(true)}
                      onError={() => setImageError(true)}
                    />
                  ) : null}
                  {sourceLink(
                    review.candidate.receiptId,
                    "Comparer avec le ticket déjà enregistré",
                  )}
                </>
              ) : null}
            </>
          ) : null}
          <Text accessibilityLiveRegion="polite">
            {state.status === "COMPLETED"
              ? outcomes[state.content.input.action]
              : state.status === "READ_ONLY"
                ? "Ce ticket est déjà publié. Ses données ne peuvent pas être reprises ou marquées comme doublon."
                : state.status === "UNCHANGED"
                  ? "Cette reprise ou cette décision est déjà enregistrée. Aucune nouvelle tâche n’a été créée."
                  : state.status === "BLOCKED"
                    ? review?.reason
                    : "Cette proposition n’a encore effectué aucune action."}
          </Text>
          {imageError ? (
            <Text style={{ color: colors.critical }}>
              Un original ne peut pas être affiché. La décision reste bloquée
              pour préserver les deux tickets.
            </Text>
          ) : null}
          {state.status === "READY" && canConfirm ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Switch
                  accessibilityLabel={
                    action === "RETRY_PROCESSING"
                      ? "Je confirme cette relance et le recours éventuel au service IA"
                      : "J’ai comparé les originaux et je confirme cette décision"
                  }
                  value={reviewed}
                  disabled={saving || imageError || !imagesReady}
                  onValueChange={setReviewed}
                />
                <Text style={{ flex: 1 }}>
                  {action === "RETRY_PROCESSING"
                    ? "Je confirme cette relance et le recours éventuel au service IA."
                    : "J’ai comparé les originaux et je confirme cette décision."}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: saving || !reviewed || imageError || !imagesReady,
                  busy: saving,
                }}
                disabled={saving || !reviewed || imageError || !imagesReady}
                style={{
                  minHeight: 44,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: colors.forest,
                  opacity:
                    saving || !reviewed || imageError || !imagesReady
                      ? 0.45
                      : 1,
                }}
                onPress={() => void confirm()}
              >
                <Text
                  style={{
                    color: colors.onAccent,
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {saving ? "Enregistrement…" : "Confirmer cette action"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la reprise du ticket" />
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
