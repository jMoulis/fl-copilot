import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { EmailIntakeOriginalRequest } from "@fl-copilot/sync-contracts";
import type { SyncContextValue } from "../sync/sync-provider";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
export type EmailProcessingControlsPort = Pick<
  NonNullable<SyncContextValue["emailIntake"]>,
  "processingState" | "retryProcessing" | "setPurpose" | "cancelProcessing"
>;
/** Local durable progress; no polling, and never label handoff as publication. */
export function EmailProcessingControls({
  inbox,
  original,
  revision,
}: {
  inbox: EmailProcessingControlsPort;
  original: EmailIntakeOriginalRequest;
  revision?: string;
}) {
  const [state, setState] =
      useState<
        Awaited<ReturnType<EmailProcessingControlsPort["processingState"]>>
      >(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    pending = useRef(false),
    epoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const current = ++epoch.current;
    const value = await inbox.processingState({
      conversationId: original.conversationId,
      receiptId: original.receiptId,
      fileId: original.fileId,
    });
    if (alive.current && current === epoch.current) setState(value);
  }, [inbox, original.conversationId, original.receiptId, original.fileId]);
  useEffect(() => {
    void load().catch(() => {
      if (alive.current) setError(true);
    });
  }, [load, revision]);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await work();
      await load();
    } catch {
      if (alive.current) setError(true);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const purpose =
    state?.status === "WAITING_INPUT" &&
    state.code === "EMAIL_INTAKE_PURPOSE_REQUIRED";
  const label = !state
    ? "Traitement à démarrer"
    : state.status === "COMPLETED"
      ? "Transmis au traitement métier"
      : state.status === "WAITING_INPUT"
        ? purpose
          ? "Que représente cette photo ?"
          : "Certains fichiers du ZIP restent à examiner"
        : state.status === "FAILED"
          ? "Traitement à reprendre"
          : state.status === "CANCELLED"
            ? "Traitement arrêté"
            : state.status === "RUNNING"
              ? "Préparation du document…"
              : state.status === "RETRY"
                ? "Nouvelle tentative en attente"
                : "Traitement en attente";
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>
        {label}
      </Text>
      {state?.status === "COMPLETED" ? (
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          L’analyse, la validation et la publication conservent leurs propres
          états.
        </Text>
      ) : null}
      {purpose ? (
        <>
          <SecondaryButton
            label="Un ticket de casse"
            disabled={busy}
            onPress={() =>
              void run(() => inbox.setPurpose(original, "WASTE_TICKET"))
            }
          />
          <SecondaryButton
            label="Une photo du rayon"
            disabled={busy}
            onPress={() =>
              void run(() => inbox.setPurpose(original, "STORE_PHOTO"))
            }
          />
        </>
      ) : null}
      {state && ["FAILED", "RETRY", "CANCELLED"].includes(state.status) ? (
        <SecondaryButton
          label="Reprendre ce fichier"
          disabled={busy}
          onPress={() => void run(() => inbox.retryProcessing(original))}
        />
      ) : null}
      {state &&
      ["PENDING", "RUNNING", "RETRY", "WAITING_INPUT"].includes(
        state.status,
      ) ? (
        <SecondaryButton
          label="Arrêter ce traitement"
          disabled={busy}
          onPress={() => void run(() => inbox.cancelProcessing(original))}
        />
      ) : null}
      {error ? (
        <>
          <InlineAlert
            title="État indisponible"
            message="Réessayez. L’original et les traitements déjà enregistrés restent conservés."
          />
          <SecondaryButton
            label="Relire l’état du fichier"
            disabled={busy}
            onPress={() => void run(load)}
          />
        </>
      ) : null}
    </View>
  );
}
