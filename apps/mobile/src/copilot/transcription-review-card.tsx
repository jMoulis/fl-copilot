import { CommercialOriginalButton } from "../commercial/original-button";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import { readTranscriptionReviewProposal } from "@fl-copilot/domain";
import {
  TranscriptionComparison,
  transcriptionConflictError,
} from "../commercial/transcription-conflict";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { colors } from "../design/tokens";
import type { CopilotTranscriptionReviewController } from "./transcription-review-controller";
export function TranscriptionReviewCard({
  message,
  controller,
  canConfirm,
  onSaved,
}: {
  message: CopilotMessage;
  controller: CopilotTranscriptionReviewController;
  canConfirm: boolean;
  onSaved: () => void;
}) {
  const artifact = useMemo(
    () => readTranscriptionReviewProposal(message),
    [message],
  );
  const base = useMemo(() => ({ message, controller }), [message, controller]);
  const [navigation, setNavigation] = useState<{
    base: object;
    cursor: string | null;
    selected: string | null;
  }>();
  const cursor = navigation?.base === base ? navigation.cursor : null,
    selected = navigation?.base === base ? navigation.selected : null;
  const [completed, setCompleted] = useState<{
    scope: object;
    review: unknown;
  } | null>(null);
  const setSelected = (value: string | null) => {
    if (state.isCurrent()) setNavigation({ base, cursor, selected: value });
  };
  const setCursor = (value: string | null) => {
    if (state.isCurrent())
      setNavigation({ base, cursor: value, selected: null });
  };
  const scope = useMemo(
    () => ({ message, controller, canConfirm, cursor, selected }),
    [message, controller, canConfirm, cursor, selected],
  );
  const read = useCallback(async () => {
    const list = await controller.list(message, cursor);
    const id = selected ?? list.items[0]?.id ?? null;
    const choice = id ? await controller.review(message, id) : null;
    return { list, id, choice };
  }, [controller, message, cursor, selected]);
  const state = useReviewedConflict({
    scope,
    read,
    canChoose: (r, useLocal) =>
      !useLocal && canConfirm && r.choice?.status === "READY",
    choose: async (r, _local, lifetime) => {
      if (!r.id || r.choice?.status !== "READY")
        throw Error("TRANSCRIPTION_REVIEW_STALE");
      await controller.confirm(
        message,
        r.id,
        r.choice.review.hash,
        true,
        lifetime.signal,
        lifetime.canResolve,
      );
      if (lifetime.canResolve()) setCompleted({ scope, review: r });
    },
    errorText: transcriptionConflictError,
    onSuccess: onSaved,
  });
  const r = state.review,
    done =
      (completed?.scope === scope && completed.review === r) ||
      r?.choice?.status === "COMPLETED";
  const ready =
    canConfirm &&
    r?.choice?.status === "READY" &&
    !done &&
    !state.reading &&
    !state.busy &&
    !state.error;
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderRadius: 16,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.ink }}>
        Comparer les transcriptions du document
      </Text>
      <Text style={{ color: colors.muted }}>
        {artifact.content.source.filename}
      </Text>
      <CommercialOriginalButton
        sourceDocumentId={artifact.content.source.sourceDocumentId}
      />
      {state.reading ? (
        <ActivityIndicator accessibilityLabel="Lecture des comparaisons locales du document" />
      ) : null}
      {r?.list.items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{
            selected: r.id === item.id,
            disabled: state.busy,
          }}
          disabled={state.busy}
          onPress={() => setSelected(item.id)}
          style={{
            minHeight: 44,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Text
            style={{
              color: colors.ink,
              fontWeight: r.id === item.id ? "700" : "400",
            }}
          >
            {item.label}
          </Text>
          <Text style={{ color: colors.muted }}>
            Page {item.pageNumber} · extrait {item.sourceBlockIndex + 1}
          </Text>
        </Pressable>
      ))}
      {r && !r.list.items.length && !r.choice ? (
        <Text style={{ color: colors.muted }}>
          Aucune comparaison locale en attente pour cette page de résultats. Les
          transcriptions et les originaux restent conservés.
        </Text>
      ) : null}
      {r?.list.completed.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.muted }}>
            Comparaisons déjà enregistrées sur cet appareil
          </Text>
          {r.list.completed.map((value) => (
            <Pressable
              key={value.operationId}
              accessibilityRole="button"
              disabled={state.busy}
              onPress={() => setSelected(value.localId)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.forest }}>
                Page {value.pageNumber} · extrait {value.sourceBlockIndex + 1} ·
                choix synchronisé adopté
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {r?.choice?.review ? (
        <TranscriptionComparison
          review={r.choice.review}
          showOriginal={false}
        />
      ) : null}
      {done ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>
          Choix synchronisé adopté. Votre transcription locale reste dans
          l’historique ; aucune offre publiée.
        </Text>
      ) : null}
      {r?.choice?.status === "BLOCKED" ? (
        <Text style={{ color: colors.muted }}>
          {r.choice.review.reason ??
            "La comparaison n’est pas résoluble dans ce contexte. Relisez-la après synchronisation ; les deux choix restent conservés."}
        </Text>
      ) : null}
      {!canConfirm ? (
        <Text style={{ color: colors.muted }}>
          Votre rôle actuel ne permet pas de confirmer cette reprise depuis le
          chat.
        </Text>
      ) : null}
      {r?.choice && !done ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch
              accessibilityLabel="J’ai comparé les transcriptions locale et synchronisée"
              value={state.compared}
              disabled={!ready}
              onValueChange={state.setCompared}
            />
            <Text style={{ color: colors.ink, flex: 1 }}>
              J’ai comparé les deux transcriptions.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conserver le choix synchronisé depuis le chat"
            accessibilityState={{ disabled: !ready || !state.compared }}
            disabled={!ready || !state.compared}
            onPress={() => void state.resolve(false)}
            style={{
              minHeight: 44,
              padding: 12,
              borderRadius: 12,
              justifyContent: "center",
              backgroundColor: colors.forest,
              opacity: ready && state.compared ? 1 : 0.5,
            }}
          >
            <Text style={{ color: colors.onAccent, fontWeight: "700" }}>
              {state.busy
                ? "Enregistrement…"
                : "Conserver le choix synchronisé"}
            </Text>
          </Pressable>
        </>
      ) : null}
      {state.error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {state.error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={state.busy || state.reading}
          onPress={() => {
            setSelected(null);
            state.reload();
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.forest }}>Relire les comparaisons</Text>
        </Pressable>
        {cursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={state.busy || state.reading}
            onPress={() => {
              setSelected(null);
              setCursor(null);
            }}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.forest }}>Revenir au début</Text>
          </Pressable>
        ) : null}
        {r?.list.nextCursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={state.busy || state.reading}
            onPress={() => {
              setSelected(null);
              setCursor(r.list.nextCursor);
            }}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.forest }}>Comparaisons suivantes</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
