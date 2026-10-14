import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotProductProposalController } from "./product-proposal-controller";
import { colors } from "../design/tokens";
const labels = {
  category: "Catégorie",
  nature: "Nature",
  salesUnit: "Unité de vente",
};
const values: Record<string, string> = {
  FRUIT: "Fruit",
  VEGETABLE: "Légume",
  OTHER: "Autre",
  UNKNOWN: "À préciser",
  BULK: "Vrac",
  PACKAGED: "Conditionné",
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
};
export function ProductProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotProductProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotProductProposalController["open"]>>>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const alive = useRef(true);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void controller
      .open(message)
      .then((value) => {
        if (alive.current) setState(value);
      })
      .catch(() => {
        if (alive.current)
          setError(
            "La proposition ne peut pas être vérifiée sur cet appareil.",
          );
      });
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const confirm = async () => {
    if (locked.current || !canConfirm) return;
    locked.current = true;
    const cancellation = new AbortController();
    abort.current = cancellation;
    setSaving(true);
    setError(undefined);
    try {
      const value = await controller.confirm(message, cancellation.signal);
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "La correction n’a pas pu être enregistrée. Vérifiez la fiche actuelle avant de réessayer.",
        );
        const value = await controller.open(message).catch(() => undefined);
        if (alive.current && value) setState(value);
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
        Correction proposée
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.proposal.before.label}
          </Text>
          {state.preview.changedFields.map((key) => (
            <Text key={key}>
              {labels[key]} : {values[state.preview.before[key]]} →{" "}
              {values[state.preview.proposed[key]]}
            </Text>
          ))}
          <Text>
            {state.status === "COMPLETED"
              ? "Correction enregistrée localement. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "La fiche a changé ou présente un conflit. Demandez un nouvel aperçu avant de confirmer."
                : state.preview.reviewFields.length
                  ? "Cette correction remplace une information déjà renseignée. Vérifiez les valeurs avant de confirmer."
                  : "Ces valeurs seront enregistrées après votre confirmation."}
          </Text>
          {state.status === "READY" && canConfirm ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => {
                void confirm();
              }}
              style={{
                backgroundColor: colors.forest,
                padding: 14,
                borderRadius: 12,
                minHeight: 44,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving ? "Enregistrement…" : "Confirmer ces changements"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la proposition" />
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
