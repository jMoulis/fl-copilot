import {
  commercialExecutionActualsSummary,
  executionActualsUpdate,
} from "@fl-copilot/domain";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotExecutionProposalController } from "./execution-proposal-controller";
import { colors } from "../design/tokens";
const statuses = {
  TODO: "À faire",
  DONE: "Fait",
  SKIPPED: "Ignoré",
  NOT_APPLICABLE: "Non applicable",
};
export function ExecutionProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotExecutionProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotExecutionProposalController["open"]>>>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const locked = useRef(false),
    generation = useRef(0),
    currentMessage = useRef(message),
    abort = useRef<AbortController | undefined>(undefined);
  currentMessage.current = message;
  useEffect(() => {
    const token = generation.current + 1;
    generation.current = token;
    locked.current = false;
    setSaving(false);
    setState(undefined);
    setError(undefined);
    void controller
      .open(currentMessage.current)
      .then((s) => {
        if (generation.current === token) setState(s);
      })
      .catch(() => {
        if (generation.current === token)
          setError(
            "La déclaration ne peut pas être vérifiée sur cet appareil.",
          );
      });
    return () => {
      if (generation.current === token) generation.current = token + 1;
      abort.current?.abort();
    };
  }, [controller, message.id]);
  const confirm = async () => {
    if (locked.current || !canConfirm) return;
    const token = generation.current,
      reviewedMessage = currentMessage.current;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = await controller.confirm(
        reviewedMessage,
        cancellation.signal,
      );
      if (generation.current === token) setState(value);
    } catch {
      if (generation.current === token) {
        setError(
          "La déclaration n’a pas pu être enregistrée. Vérifiez le plan et réessayez.",
        );
        const s = await controller.open(reviewedMessage).catch(() => undefined);
        if (generation.current === token && s) setState(s);
      }
    } finally {
      if (generation.current === token) locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (generation.current === token) setSaving(false);
    }
  };
  return (
    <View
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.forest, fontWeight: "700" }}>
        Mise en place commerciale
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.proposal.label}
          </Text>
          <Text>
            Semaine du{" "}
            {new Date(
              state.content.input.weekStart + "T00:00:00Z",
            ).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
          </Text>
          <Text>
            {statuses[state.content.before?.status ?? "TODO"]} →{" "}
            {statuses[state.content.input.status]}
          </Text>
          <Text>
            {commercialExecutionActualsSummary(
              executionActualsUpdate(state.content.before, state.content.input)
                .actuals,
            )}
          </Text>
          {state.content.input.actuals === null &&
          state.content.before?.actuals ? (
            <Text>
              Les détails de réalisation précédents seront effacés de la version
              courante ; leur historique reste conservé.
            </Text>
          ) : null}
          {state.content.before?.actuals &&
          state.content.input.actuals !== undefined ? (
            <Text>
              Détails précédents :{" "}
              {commercialExecutionActualsSummary(state.content.before.actuals)}
            </Text>
          ) : null}
          {state.content.input.note ? (
            <Text>Note : {state.content.input.note}</Text>
          ) : null}
          {state.content.before?.note &&
          state.content.before.note !== state.content.input.note ? (
            <Text>Note précédente : {state.content.before.note}</Text>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Déclaration enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le plan ou la déclaration a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vous confirmez votre déclaration. L’application n’imprime pas d’affiche et n’installe pas la TG."}
          </Text>
          {state.status === "READY" && canConfirm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving}
              onPress={() => {
                void confirm();
              }}
              style={{
                minHeight: 44,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.forest,
              }}
            >
              <Text
                style={{
                  color: colors.onAccent,
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving ? "Enregistrement…" : "Confirmer la déclaration"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la déclaration" />
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
