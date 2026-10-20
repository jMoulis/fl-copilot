import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import {
  commercialExecutionActualsSummary,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { CopilotActionExecutionRepository } from "./action-execution-repository";
import { colors } from "../design/tokens";
export function ActionExecutionCard({
  message,
  repository,
  canConfirm,
}: {
  message: CopilotMessage;
  repository: CopilotActionExecutionRepository;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotActionExecutionRepository["open"]>>>(),
    [error, setError] = useState<string>(),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    currentMessage = useRef(message),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  currentMessage.current = message;
  useEffect(() => {
    const token = generation.current + 1;
    generation.current = token;
    setState(undefined);
    setChecked(false);
    setError(undefined);
    setBusy(false);
    locked.current = false;
    void repository
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
  }, [repository, message.id]);
  const refresh = async () => {
    if (locked.current) return;
    const token = generation.current;
    setChecked(false);
    setBusy(true);
    setError(undefined);
    try {
      const s = await repository.open(currentMessage.current);
      if (generation.current === token) setState(s);
    } catch {
      if (generation.current === token)
        setError("Vérification indisponible. Vos données sont conservées.");
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const save = async () => {
    if (locked.current || !checked || !canConfirm || !state) return;
    locked.current = true;
    const token = generation.current,
      cancellation = new AbortController();
    abort.current = cancellation;
    setBusy(true);
    setError(undefined);
    try {
      const s = await repository.save(
        currentMessage.current,
        state.review,
        state.status === "CONFIRMED",
        cancellation.signal,
      );
      if (generation.current === token) {
        setState(s);
        setChecked(false);
      }
    } catch {
      if (generation.current === token) {
        setError(
          "La déclaration n’a pas changé. Actualisez l’aperçu avant de réessayer.",
        );
        setChecked(false);
      }
    } finally {
      if (generation.current === token) {
        locked.current = false;
        setBusy(false);
      }
      if (abort.current === cancellation) abort.current = undefined;
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
        Réalisation déclarée
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.snapshot.action}
          </Text>
          <Text>
            Conseil d’origine : « {state.content.snapshot.basis.quote} »
          </Text>
          <Text>
            {commercialExecutionActualsSummary(state.content.snapshot.actuals)}
          </Text>
          {state.content.snapshot.notes ? (
            <Text>Note : {state.content.snapshot.notes}</Text>
          ) : null}
          <Text>
            {state.status === "WITHDRAWN"
              ? "Déclaration retirée. Son contenu d’origine reste dans l’historique ; aucun chiffre n’est annulé automatiquement."
              : state.status === "CONFIRMED"
                ? "Réalisation enregistrée dans votre suivi privé. Elle ne modifie ni votre choix, ni le plan, ni les chiffres."
                : state.status === "STALE"
                  ? "Le conseil d’origine n’est plus vérifiable ici. Actualisez ou demandez un nouvel aperçu."
                  : state.status === "ERROR"
                    ? "La déclaration reste conservée ; vérifiez sa synchronisation ou la capacité du suivi."
                    : "Confirmez uniquement ce que vous avez réalisé. L’application ne réalise pas l’action physique et ne revalide pas les faits du conseil."}
          </Text>
          {state.link ? (
            <Text>
              Déclaration :{" "}
              {new Date(state.link.createdAt).toLocaleString("fr-FR")}
              {state.link.withdrawnAt
                ? ` · Retrait : ${new Date(state.link.withdrawnAt).toLocaleString("fr-FR")}`
                : ""}
            </Text>
          ) : null}
          {state.syncState ? (
            <Text>
              {state.syncState === "SYNCED"
                ? "Synchronisé"
                : state.syncState === "PENDING"
                  ? "À synchroniser"
                  : "Enregistrement à vérifier"}
            </Text>
          ) : null}
          {canConfirm && ["READY", "CONFIRMED"].includes(state.status) ? (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={() => setChecked((v) => !v)}
                style={{ minHeight: 44, padding: 12 }}
              >
                <Text>
                  {checked ? "☑" : "☐"}{" "}
                  {state.status === "CONFIRMED"
                    ? "Je retire cette déclaration en conservant son historique."
                    : "Je confirme avoir réalisé l’action décrite ci-dessus."}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !checked, busy }}
                disabled={busy || !checked}
                onPress={() => void save()}
                style={{
                  minHeight: 44,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: checked ? colors.forest : colors.muted,
                }}
              >
                <Text
                  style={{
                    color: colors.onAccent,
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {busy
                    ? "Enregistrement…"
                    : state.status === "CONFIRMED"
                      ? "Retirer la déclaration"
                      : "Enregistrer la réalisation"}
                </Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void refresh()}
            style={{ minHeight: 44, padding: 12 }}
          >
            <Text style={{ color: colors.forest }}>Vérifier à nouveau</Text>
          </Pressable>
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
