import { todayCalendarDate } from "../dates/calendar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  CopilotMessage,
  RecommendationChoice,
  RecommendationDecision,
} from "@fl-copilot/domain";
import type { CopilotDecisionRepository } from "./decision-repository";
import { DateSelector } from "../components/date-selector";
import { colors } from "../design/tokens";
const labels = {
  ACCEPT: "Accepter",
  MODIFY: "Modifier",
  POSTPONE: "Reporter",
  REJECT: "Refuser",
};
const done = {
  ACCEPT: "Acceptée",
  MODIFY: "Action modifiée",
  POSTPONE: "Reportée",
  REJECT: "Refusée",
};
const date = (v: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(v));
function ChoiceSummary({
  value,
}: {
  value: RecommendationDecision["revisions"][number];
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: "600" }}>
        {done[value.type]} · {date(value.decidedAt)}
      </Text>
      {value.modifiedAction ? <Text>{value.modifiedAction}</Text> : null}
      {value.postponeUntil ? (
        <Text>
          À reprendre le {value.postponeUntil.split("-").reverse().join("/")}
        </Text>
      ) : null}
      {value.reason ? <Text>Note : {value.reason}</Text> : null}
    </View>
  );
}
export function RecommendationDecisionCard({
  message,
  repository,
  canConfirm,
}: {
  message: CopilotMessage;
  repository: CopilotDecisionRepository;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotDecisionRepository["open"]>>>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<RecommendationChoice["type"]>(),
    [action, setAction] = useState(""),
    [postpone, setPostpone] = useState(""),
    [reason, setReason] = useState(""),
    [side, setSide] = useState<"LOCAL" | "REMOTE">(),
    [historyLimit, setHistoryLimit] = useState(5);
  const generation = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const token = ++generation.current;
    setState(undefined);
    setBusy(false);
    setError(undefined);
    setEditing(false);
    setSelected(undefined);
    setSide(undefined);
    setAction("");
    setPostpone("");
    setReason("");
    setHistoryLimit(5);
    void repository
      .open(message)
      .then((s) => {
        if (generation.current === token) setState(s);
      })
      .catch(() => {
        if (generation.current === token)
          setError(
            "Le conseil d’origine n’est pas disponible sur cet appareil. Actualisez la conversation.",
          );
      });
    return () => {
      generation.current = token + 1;
      abort.current?.abort();
    };
  }, [repository, message]);
  const refresh = async () => {
    if (locked.current) return;
    const token = generation.current;
    setError(undefined);
    try {
      const s = await repository.open(message);
      if (token === generation.current) {
        setState(s);
        setSelected(undefined);
        setSide(undefined);
        setEditing(false);
      }
    } catch {
      if (token === generation.current)
        setError("Le suivi n’a pas pu être actualisé.");
    }
  };
  const run = async (resolve: boolean) => {
    if (
      locked.current ||
      !canConfirm ||
      !state ||
      (resolve ? !side : !selected)
    )
      return;
    const token = generation.current,
      cancellation = new AbortController();
    abort.current = cancellation;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = resolve
        ? await repository.resolve(
            message,
            side === "LOCAL",
            state.review,
            cancellation.signal,
          )
        : await repository.save(
            message,
            {
              type: selected!,
              modifiedAction:
                selected === "MODIFY" ? action.trim() || null : null,
              postponeUntil: selected === "POSTPONE" ? postpone || null : null,
              reason: reason.trim() || null,
            },
            state.review,
            cancellation.signal,
          );
      if (generation.current === token) {
        setState(next);
        setEditing(false);
        setSelected(undefined);
        setSide(undefined);
      }
    } catch {
      if (generation.current === token) {
        setError(
          "La décision n’a pas été enregistrée. Vérifiez le champ requis, la date et la version affichée ; actualisez avant de réessayer.",
        );
        const current = await repository.open(message).catch(() => undefined);
        if (generation.current === token) {
          if (current) setState(current);
          setSelected(undefined);
          setSide(undefined);
        }
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (generation.current === token) setBusy(false);
    }
  };
  const canAppend =
    !!state?.hasCapacity && (state?.decision?.version ?? 0) < 50;
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.forest,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: colors.forest, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
        gap: 12,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        Suivre ce conseil
      </Text>
      {state ? (
        <>
          <Text style={{ color: colors.muted }}>
            Conseil du {date(state.content.basis.sourceCreatedAt)}
          </Text>
          <Text>{state.content.basis.quote}</Text>
          <Text style={{ color: colors.muted }}>
            Le contexte et les chiffres ne sont pas revalidés ici. Accepter
            garde cette piste dans votre suivi ; cela ne réalise aucune action.
          </Text>
          {state.decision ? (
            <>
              <ChoiceSummary value={state.decision.revisions.at(-1)!} />
              <Text accessibilityLiveRegion="polite">
                {state.syncState === "SYNCED"
                  ? "Décision synchronisée."
                  : state.syncState === "CONFLICT"
                    ? "Choix contradictoires à comparer."
                    : state.syncState === "ERROR"
                      ? "Synchronisation refusée : examinez la source dans la conversation."
                      : "Décision enregistrée sur cet appareil, à synchroniser."}
              </Text>
            </>
          ) : null}
          {state.status === "CONFLICT" ? (
            <>
              <Text style={{ fontWeight: "700" }}>Votre choix</Text>
              {state.decision ? (
                <ChoiceSummary value={state.decision.revisions.at(-1)!} />
              ) : null}
              <Text style={{ fontWeight: "700" }}>Choix synchronisé</Text>
              {state.remote ? (
                <ChoiceSummary value={state.remote.revisions.at(-1)!} />
              ) : (
                <Text>Version synchronisée indisponible.</Text>
              )}
              {!state.canRetainLocal ? (
                <Text>
                  {state.retentionIssue === "POSTPONE_DATE_PASSED"
                    ? "La date du report local est passée. Reprenez le choix synchronisé avant de saisir une nouvelle date."
                    : state.retentionIssue === "HISTORY_LIMIT"
                      ? "L’historique synchronisé est complet ; il peut être repris sans ajouter un choix."
                      : "Le conseil d’origine n’est plus actif : seul le choix synchronisé peut être repris."}
                </Text>
              ) : null}
              {canConfirm && state.canResolve ? (
                <>
                  {(["LOCAL", "REMOTE"] as const).map((v) => (
                    <Pressable
                      key={v}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: side === v,
                        disabled:
                          busy || (v === "LOCAL" && !state.canRetainLocal),
                      }}
                      disabled={
                        busy || (v === "LOCAL" && !state.canRetainLocal)
                      }
                      onPress={() => setSide(v)}
                      style={{
                        padding: 12,
                        minHeight: 44,
                        borderWidth: 1,
                        borderColor: side === v ? colors.forest : colors.line,
                        borderRadius: 12,
                      }}
                    >
                      <Text>
                        {v === "LOCAL"
                          ? "Conserver mon choix"
                          : "Reprendre le choix synchronisé"}
                      </Text>
                    </Pressable>
                  ))}
                  {button(
                    "Confirmer ce choix",
                    () => {
                      void run(true);
                    },
                    busy || !side,
                  )}
                </>
              ) : (
                <Text>Actualisez pour obtenir une comparaison complète.</Text>
              )}
            </>
          ) : state.status === "READY" &&
            canConfirm &&
            canAppend &&
            (!state.decision || editing) ? (
            <>
              <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                {(
                  Object.keys(labels) as Array<RecommendationChoice["type"]>
                ).map((v) => (
                  <Pressable
                    key={v}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: selected === v,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => setSelected(v)}
                    style={{
                      minHeight: 44,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: selected === v ? colors.forest : colors.line,
                      borderRadius: 12,
                    }}
                  >
                    <Text>{labels[v]}</Text>
                  </Pressable>
                ))}
              </View>
              {selected === "MODIFY" ? (
                <TextInput
                  accessibilityLabel="Action modifiée"
                  placeholder="L’action que vous retenez"
                  multiline
                  maxLength={1200}
                  value={action}
                  editable={!busy}
                  onChangeText={setAction}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: 12,
                    padding: 12,
                    minHeight: 80,
                  }}
                />
              ) : null}
              {selected === "POSTPONE" ? (
                <DateSelector
                  label="Date de reprise"
                  description="Choisissez quand reprendre ce conseil."
                  value={postpone}
                  disabled={busy}
                  issue={
                    postpone && postpone < todayCalendarDate()
                      ? "Choisissez aujourd’hui ou une date à venir."
                      : undefined
                  }
                  onConfirm={setPostpone}
                />
              ) : null}
              {selected ? (
                <>
                  <TextInput
                    accessibilityLabel="Note de décision, facultative"
                    placeholder="Note facultative"
                    value={reason}
                    editable={!busy}
                    maxLength={600}
                    multiline
                    onChangeText={setReason}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: 12,
                      padding: 12,
                      minHeight: 44,
                    }}
                  />
                  {button(
                    "Enregistrer ma décision",
                    () => {
                      void run(false);
                    },
                    busy ||
                      (selected === "MODIFY" && !action.trim()) ||
                      (selected === "POSTPONE" &&
                        (!postpone || postpone < todayCalendarDate())),
                  )}
                </>
              ) : null}
            </>
          ) : state.status === "READY" && canConfirm && canAppend ? (
            button(
              "Changer ma décision",
              () => {
                setEditing(true);
                setSelected(undefined);
                setAction("");
                setReason("");
                setPostpone("");
              },
              busy,
            )
          ) : state.status === "SOURCE_UNAVAILABLE" ? (
            <Text>
              Le conseil d’origine est archivé, retiré ou incomplet sur cet
              appareil. Votre historique reste conservé ; aucun nouveau choix ne
              peut être enregistré.
            </Text>
          ) : null}
          {!canAppend ? (
            <Text>
              La limite de suivi sur cet appareil est atteinte. L’historique est
              conservé ; aucun choix supplémentaire n’est enregistré.
            </Text>
          ) : null}
          {!state.sourceLocallyAvailable ? (
            <Text>
              L’extrait est conservé dans cette carte. Le message complet n’est
              pas chargé ici ; sa validité sera contrôlée à la synchronisation.
            </Text>
          ) : null}
          {state.decision && state.decision.revisions.length > 1 ? (
            <>
              <Text style={{ fontWeight: "600" }}>
                Historique des décisions
              </Text>
              {[...state.decision.revisions]
                .reverse()
                .slice(0, historyLimit)
                .map((r) => (
                  <ChoiceSummary key={r.version} value={r} />
                ))}
              {historyLimit < state.decision.revisions.length
                ? button(
                    "Voir les décisions précédentes",
                    () => setHistoryLimit((n) => n + 5),
                    busy,
                  )
                : null}
            </>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Chargement du suivi" />
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
      {button(
        "Actualiser le suivi",
        () => {
          void refresh();
        },
        busy,
      )}
    </View>
  );
}
