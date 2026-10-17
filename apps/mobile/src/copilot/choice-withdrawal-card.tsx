import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotChoiceWithdrawalController } from "./choice-withdrawal-controller";
import { colors } from "../design/tokens";
export function ChoiceWithdrawalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotChoiceWithdrawalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotChoiceWithdrawalController["open"]>>>();
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
          setError("Le retrait ne peut pas être vérifié sur cet appareil.");
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
          "Le retrait n’a pas pu être enregistré. Vérifiez la synchronisation et demandez un nouvel aperçu.",
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
        Retirer une offre retenue
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.before.rawProductLabel}
          </Text>
          <Text>
            Retenue → Retirée · version {state.content.before.version}
          </Text>
          <Text>
            {state.content.before.operationLabel} ·{" "}
            {formatFrenchCalendarDate(state.content.before.saleStart)} au{" "}
            {formatFrenchCalendarDate(state.content.before.saleEnd)}
          </Text>
          <Text>
            {commercialMechanismDescription(state.content.before.mechanism)}
          </Text>
          <Text>
            Les documents, plans validés et déclarations de mise en place
            restent conservés. Les brouillons utilisant cette offre devront être
            examinés. Aucune TG ni affectation ne sera retirée automatiquement.
          </Text>
          <Text>
            {state.status === "COMPLETED"
              ? "Offre retirée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le choix commercial a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vous confirmez uniquement le retrait de cette offre de la sélection du magasin."}
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
                {saving ? "Enregistrement…" : "Confirmer le retrait de l’offre"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification du retrait" />
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
