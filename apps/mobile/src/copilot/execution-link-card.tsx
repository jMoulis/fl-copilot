import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotExecutionLinkRepository } from "./execution-link-repository";
import { colors } from "../design/tokens";
const choices = {
  ACCEPT: "Accepté",
  MODIFY: "Modifié",
  POSTPONE: "Reporté",
  REJECT: "Refusé",
};
const statuses = {
  TODO: "À faire",
  DONE: "Déclarée faite",
  SKIPPED: "Ignorée",
  NOT_APPLICABLE: "Non applicable",
};
export function ExecutionLinkCard({
  message,
  repository,
  canConfirm,
}: {
  message: CopilotMessage;
  repository: CopilotExecutionLinkRepository;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotExecutionLinkRepository["open"]>>>(),
    [error, setError] = useState<string>(),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    currentMessage = useRef(message),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  currentMessage.current = message;
  useEffect(() => {
    const token = ++generation.current;
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
            "Le choix et la déclaration ne peuvent pas être vérifiés sur cet appareil.",
          );
      });
    return () => {
      generation.current = token + 1;
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
          "L’association n’a pas changé. Actualisez la comparaison avant de réessayer.",
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
  const actionable = state?.status === "READY" || state?.status === "CONFIRMED";
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.forest,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        Suivi de votre choix
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {choices[state.content.snapshot.decision.revision.type]} — version{" "}
            {state.content.snapshot.decision.version}
          </Text>
          <Text>
            {state.content.snapshot.decision.revision.modifiedAction ??
              state.content.snapshot.decision.basis.quote}
          </Text>
          <Text>
            Choix du{" "}
            {new Date(
              state.content.snapshot.decision.revision.decidedAt,
            ).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
          </Text>
          {state.content.snapshot.decision.revision.postponeUntil ? (
            <Text>
              Report prévu le{" "}
              {new Date(
                state.content.snapshot.decision.revision.postponeUntil +
                  "T00:00:00Z",
              ).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
            </Text>
          ) : null}
          {state.content.snapshot.decision.revision.reason ? (
            <Text>
              Note du choix : {state.content.snapshot.decision.revision.reason}
            </Text>
          ) : null}
          <Text style={{ fontWeight: "600" }}>
            {state.content.snapshot.task.label}
          </Text>
          <Text>
            {statuses[state.content.snapshot.task.status]} — déclaration version{" "}
            {state.content.snapshot.task.version}
          </Text>
          <Text>
            {state.content.snapshot.task.completedAt
              ? "Date de déclaration : " +
                new Date(
                  state.content.snapshot.task.completedAt,
                ).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })
              : "Aucune réalisation déclarée."}
          </Text>
          {state.content.snapshot.task.note ? (
            <Text>Note de la tâche : {state.content.snapshot.task.note}</Text>
          ) : null}
          <Text>
            {state.status === "WITHDRAWN"
              ? "Lien retiré. Les versions d’origine restent conservées dans l’historique."
              : state.status === "CONFIRMED"
                ? "Association enregistrée. Elle relie uniquement ces versions, même si le choix ou la tâche change ensuite."
                : state.status === "STALE"
                  ? "Le choix ou la déclaration a changé. Synchronisez puis demandez un nouvel aperçu."
                  : state.status === "ERROR"
                    ? !state.link
                      ? "La capacité de suivi est atteinte. Aucun nouveau lien n’a été créé ; votre historique est conservé."
                      : state.link.version === 2
                        ? "Le retrait est conservé localement mais sa synchronisation doit être vérifiée dans Synchronisation. L’historique et la tâche sont conservés."
                        : "L’association locale reste conservée. Vérifiez son état dans Synchronisation ; aucune tâche n’a été modifiée."
                    : "Confirmer ce lien ne change ni le choix ni la tâche, et ne prouve pas leur effet sur les chiffres. Le contexte du conseil n’est pas revalidé."}
          </Text>
          {state.syncState ? (
            <Text>
              {state.syncState === "SYNCED"
                ? "Synchronisé"
                : state.syncState === "PENDING"
                  ? "À synchroniser"
                  : "Enregistrement à vérifier"}
            </Text>
          ) : null}
          {state.link ? (
            <>
              <Text>
                Lien confirmé le{" "}
                {new Date(state.link.createdAt).toLocaleString("fr-FR", {
                  timeZone: "Europe/Paris",
                })}
              </Text>
              {state.link.withdrawnAt ? (
                <Text>
                  Retrait enregistré le{" "}
                  {new Date(state.link.withdrawnAt).toLocaleString("fr-FR", {
                    timeZone: "Europe/Paris",
                  })}
                </Text>
              ) : null}
            </>
          ) : null}
          {actionable && canConfirm ? (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={() => setChecked((v) => !v)}
                style={{
                  minHeight: 44,
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  borderColor: colors.forest,
                }}
              >
                <Text>
                  {checked ? "☑" : "☐"}{" "}
                  {state.status === "CONFIRMED"
                    ? "Je souhaite retirer ce lien en conservant son historique."
                    : "Ces deux éléments concernent bien la même action."}
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
                    color: "white",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {busy
                    ? "Enregistrement…"
                    : state.status === "CONFIRMED"
                      ? "Retirer le lien"
                      : "Confirmer l’association"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de l’association" />
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void refresh()}
        style={{ minHeight: 44, padding: 12 }}
      >
        <Text style={{ color: colors.forest }}>Actualiser la comparaison</Text>
      </Pressable>
    </View>
  );
}
