import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  CopilotFormError,
  CopilotToolError,
  type CopilotMessage,
  type CopilotFormAnswers,
  type CopilotFormIssue,
} from "@fl-copilot/domain";
import {
  CopilotInlineFormCard,
  type CopilotFormCardAction,
} from "./inline-form-card";
import { CopilotFormCardActionError } from "./form-card-controller";
import type { CopilotInformationFormController } from "./information-form-controller";
import { colors } from "../design/tokens";
type State = Awaited<ReturnType<CopilotInformationFormController["open"]>>;
export function InformationFormCard({
  message,
  controller,
  onSubmitted,
}: {
  message: CopilotMessage;
  controller: CopilotInformationFormController;
  onSubmitted(): Promise<void>;
}) {
  const [state, setState] = useState<State>();
  const [values, setValues] = useState<CopilotFormAnswers>({});
  const [issues, setIssues] = useState<CopilotFormIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useRef(true),
    locked = useRef(false),
    revision = useRef(0);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void controller
      .open(message)
      .then((value) => {
        if (alive.current) {
          setState(value);
          setValues(value.form.answers);
        }
      })
      .catch(() => {
        if (alive.current)
          setError("Cette question ne peut pas être ouverte sur cet appareil.");
      });
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const answer = (key: string, value: CopilotFormAnswers[string]) => {
    if (locked.current) return;
    const current = ++revision.current;
    setValues((old) => ({ ...old, [key]: value }));
    setIssues((old) => old.filter((issue) => issue.key !== key));
    void controller
      .save(message, { [key]: value })
      .then((saved) => {
        if (alive.current) {
          setState(saved);
          if (revision.current === current) setValues(saved.form.answers);
        }
      })
      .catch(() => {
        if (alive.current)
          setError(
            "Le brouillon n’a pas pu être enregistré. Votre réponse reste affichée.",
          );
      });
  };
  const action = async (value: CopilotFormCardAction) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const saved = await controller.perform(
        message,
        value,
        values,
        cancellation.signal,
      );
      if (alive.current) {
        setState(saved);
        setValues(saved.form.answers);
        setIssues([]);
      }
      if (saved.responseMessage && value === "SUBMIT" && alive.current)
        await onSubmitted();
    } catch (reason) {
      if (alive.current) {
        if (reason instanceof CopilotFormCardActionError) {
          setIssues(reason.issues);
          if (reason.form)
            setState((old) => (old ? { ...old, form: reason.form! } : old));
        }
        const original =
          reason instanceof CopilotFormCardActionError
            ? reason.original
            : reason;
        setError(
          original instanceof CopilotFormError ||
            original instanceof CopilotToolError
            ? original.message
            : "La réponse n’a pas pu être enregistrée. Votre brouillon est conservé.",
        );
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (alive.current) setBusy(false);
    }
  };
  if (!state)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        {!error ? (
          <ActivityIndicator accessibilityLabel="Ouverture de la question" />
        ) : null}
        {error ? <Text style={{ color: colors.critical }}>{error}</Text> : null}
      </View>
    );
  if (state.responseMessage && state.form.status !== "ANSWERED")
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>{state.form.definition.title}</Text>
        <Text>
          Une réponse à cette question est déjà enregistrée dans le chat.
        </Text>
      </View>
    );
  return (
    <CopilotInlineFormCard
      form={state.form}
      values={values}
      issues={issues}
      busy={busy}
      error={error}
      notice={
        state.responseMessage
          ? state.responseSyncState === "SYNCED"
            ? "Réponse synchronisée."
            : "Réponse conservée, en attente de synchronisation."
          : undefined
      }
      onAnswer={answer}
      onAction={(value) => {
        void action(value);
      }}
    />
  );
}
