import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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
    alive = useRef(true),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    let active = true;
    setState(undefined);
    setError(undefined);
    void controller
      .open(message)
      .then((s) => {
        if (active && alive.current) setState(s);
      })
      .catch(() => {
        if (active && alive.current)
          setError(
            "La déclaration ne peut pas être vérifiée sur cet appareil.",
          );
      });
    return () => {
      active = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const confirm = async () => {
    if (locked.current || !canConfirm) return;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = await controller.confirm(message, cancellation.signal);
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "La déclaration n’a pas pu être enregistrée. Vérifiez le plan et réessayez.",
        );
        const s = await controller.open(message).catch(() => undefined);
        if (alive.current && s) setState(s);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (alive.current) setSaving(false);
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
                  color: "white",
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
