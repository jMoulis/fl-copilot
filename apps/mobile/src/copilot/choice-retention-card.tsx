import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage, CommercialMechanism } from "@fl-copilot/domain";
import type { CopilotChoiceRetentionController } from "./choice-retention-controller";
import { colors } from "../design/tokens";
const terms = (m: CommercialMechanism) =>
  commercialMechanismDescription(m) +
  (m.type === "CARD_BENEFIT" ? ` · Portée : ${m.scope ?? "non précisée"}` : "");
export function ChoiceRetentionCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotChoiceRetentionController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotChoiceRetentionController["open"]>>>();
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
            "La remise en sélection ne peut pas être vérifiée sur cet appareil.",
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
          "La remise en sélection n’a pas pu être enregistrée. Vérifiez la synchronisation et demandez un nouvel aperçu.",
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
        Retenir à nouveau une offre
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.basis.before.rawProductLabel}
          </Text>
          <Text>
            Produit associé conservé : {state.content.basis.product.label}
          </Text>
          <Text>Statut : Retirée → Retenue</Text>
          <Text>
            Dates conservées :{" "}
            {formatFrenchCalendarDate(state.content.basis.before.saleStart)} –{" "}
            {formatFrenchCalendarDate(state.content.basis.before.saleEnd)}
          </Text>
          <Text>
            Conditions conservées :{" "}
            {terms(state.content.basis.before.mechanism)}
          </Text>
          <Text>Note : {state.content.basis.before.note ?? "Sans note"}</Text>
          <Text>
            La source, le produit et les conditions restent inchangés. Les
            validations et références de brouillons de l’ancienne version
            devront être réexaminées ; les plans validés et les TG ne sont pas
            modifiés automatiquement.
          </Text>
          <Text>
            {state.status === "COMPLETED"
              ? "Offre retenue à nouveau sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le choix commercial a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vous choisissez explicitement de retenir à nouveau cette offre précédemment retirée. Aucune validation de plan ni mise en rayon."}
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
                {saving ? "Enregistrement…" : "Retenir à nouveau cette offre"}
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
