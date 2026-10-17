import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage, CommercialMechanism } from "@fl-copilot/domain";
import type { CopilotChoiceUpdateController } from "./choice-update-controller";
import { colors } from "../design/tokens";
const terms = (m: CommercialMechanism) =>
  commercialMechanismDescription(m) +
  (m.type === "CARD_BENEFIT" ? ` · Portée : ${m.scope ?? "non précisée"}` : "");
export function ChoiceUpdateCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotChoiceUpdateController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotChoiceUpdateController["open"]>>>();
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
            "La modification ne peut pas être vérifiée sur cet appareil.",
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
          "La modification n’a pas pu être enregistrée. Vérifiez la synchronisation et demandez un nouvel aperçu.",
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
        Modifier une offre retenue
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.basis.before.rawProductLabel}
          </Text>
          <Text>
            Produit associé conservé : {state.content.basis.product.label}
          </Text>
          {state.content.input.patch.saleStart !== undefined ||
          state.content.input.patch.saleEnd !== undefined ? (
            <Text>
              Dates :{" "}
              {formatFrenchCalendarDate(state.content.basis.before.saleStart)} –{" "}
              {formatFrenchCalendarDate(state.content.basis.before.saleEnd)} →{" "}
              {formatFrenchCalendarDate(state.request.input.draft.saleStart)} –{" "}
              {formatFrenchCalendarDate(state.request.input.draft.saleEnd)}
            </Text>
          ) : null}
          {state.content.input.patch.mechanism !== undefined ? (
            <Text>
              Conditions : {terms(state.content.basis.before.mechanism)} →{" "}
              {terms(state.request.input.draft.mechanism)}
            </Text>
          ) : null}
          {state.content.input.patch.note !== undefined ? (
            <Text>
              Note : {state.content.basis.before.note ?? "Sans note"} →{" "}
              {state.request.input.draft.note ?? "Sans note"}
            </Text>
          ) : null}
          <Text>
            La source et le produit restent inchangés. Les validations et
            références de brouillons de l’ancienne version devront être
            réexaminées ; les plans validés et les TG ne sont pas modifiés
            automatiquement.
          </Text>
          <Text>
            {state.status === "COMPLETED"
              ? "Modification enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le choix commercial a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vous confirmez les conditions affichées de cette offre retenue. Aucune validation de plan ni mise en rayon."}
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
                {saving ? "Enregistrement…" : "Confirmer les modifications"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la modification" />
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
