import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import { checkStoreLayoutGeometry } from "@fl-copilot/commercial-core";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { LayoutComparison } from "../store/layout-comparison";
import { LayoutGeometryReport } from "../store/layout-geometry-report";
import type { CopilotStoreLayoutEditController } from "./store-layout-edit-controller";
export function StoreLayoutEditCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotStoreLayoutEditController;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotStoreLayoutEditController["open"]>>>(),
    [visible, setVisible] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string>();
  const epoch = useRef(0);
  const alive = useRef(true),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    ++epoch.current;
    locked.current = false;
    setSaving(false);
    let active = true;
    setState(undefined);
    setError(undefined);
    setVisible(false);
    void controller
      .open(message)
      .then((value) => {
        if (active && alive.current) setState(value);
      })
      .catch(() => {
        if (active && alive.current)
          setError(
            "Cette proposition ne peut pas être vérifiée sur cet appareil. Synchronisez la discussion et le plan du magasin, puis réessayez.",
          );
      });
    return () => {
      active = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const refresh = async () => {
    const generation = epoch.current;
    setError(undefined);
    try {
      const value = await controller.open(message);
      if (alive.current && epoch.current === generation) setState(value);
    } catch {
      if (alive.current && epoch.current === generation)
        setError(
          "Le plan ou la proposition ne sont pas disponibles sur cet appareil.",
        );
    }
  };
  const confirm = async () => {
    const generation = epoch.current;
    if (locked.current || !canConfirm || state?.status !== "READY") return;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = await controller.confirm(message, cancellation.signal);
      if (alive.current && epoch.current === generation) {
        setState(value);
        setVisible(false);
      }
    } catch {
      if (alive.current && epoch.current === generation) {
        await refresh();
        if (alive.current && epoch.current === generation)
          setError(
            "Le brouillon n’a pas pu être enregistré. Le plan a pu changer ou nécessiter une résolution de synchronisation ; demandez une nouvelle proposition si nécessaire.",
          );
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (alive.current && epoch.current === generation) setSaving(false);
    }
  };
  const details = state?.status === "READY" ? state.review : null;
  const geometry = useMemo(
    () => (details ? checkStoreLayoutGeometry(details.after) : null),
    [details],
  );
  return (
    <View className="gap-3 rounded-2xl border border-line bg-white p-4">
      <Text className="font-semibold text-ink">
        Modification du plan du magasin
      </Text>
      <Text className="text-muted">
        {state?.status === "COMPLETED"
          ? "Brouillon enregistré sur cet appareil. La référence adoptée reste conservée ; la synchronisation peut être en attente."
          : state?.status === "STALE"
            ? "Le plan a changé, manque sur cet appareil ou nécessite une résolution. Consultez le plan actuel puis demandez une nouvelle proposition."
            : details
              ? `${details.changes.length} modification${details.changes.length > 1 ? "s" : ""} à examiner. Rien n’est encore enregistré.`
              : "Vérification de la proposition…"}
      </Text>
      {details ? (
        <SecondaryButton
          label="Examiner les modifications du plan"
          onPress={() => setVisible(true)}
        />
      ) : null}
      {state?.status === "STALE" || error ? (
        <SecondaryButton
          label="Vérifier à nouveau"
          onPress={() => {
            void refresh();
          }}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Enregistrement indisponible" message={error} />
      ) : null}
      <BottomSheet
        visible={visible && !!details}
        title="Vérifier le brouillon du plan"
        swipeToClose
        onClose={() => {
          abort.current?.abort();
          setVisible(false);
        }}
      >
        {details ? (
          <>
            <Text className="text-muted">
              Cette confirmation enregistre un brouillon. Elle ne remplace pas
              la référence adoptée et ne déclare aucune installation réalisée.
              Les nouvelles mesures sont déclarées ; les valeurs inconnues
              restent à préciser.
            </Text>
            <LayoutComparison before={details.before} after={details.after} />
            <LayoutGeometryReport content={details.after} result={geometry!} />
            {error ? (
              <InlineAlert title="Brouillon non enregistré" message={error} />
            ) : null}
            {canConfirm ? (
              <PrimaryButton
                label={
                  saving
                    ? "Enregistrement…"
                    : "Confirmer et enregistrer le brouillon"
                }
                disabled={saving}
                onPress={() => {
                  void confirm();
                }}
              />
            ) : (
              <InlineAlert
                title="Consultation seule"
                message="Seul un responsable du magasin peut confirmer cette modification."
              />
            )}
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
}
