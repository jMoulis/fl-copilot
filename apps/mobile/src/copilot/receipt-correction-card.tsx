import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import type {
  CopilotMessage,
  ReceiptCorrectionChange,
} from "@fl-copilot/domain";
import type { CopilotReceiptCorrectionController } from "./receipt-correction-controller";
import { colors } from "../design/tokens";
const labels: Record<ReceiptCorrectionChange["field"], string> = {
  wasteDate: "Date de casse",
  cashierNumber: "Numéro de caissier",
  rawLabel: "Libellé",
  quantity: "Quantité",
  quantityUnit: "Unité de quantité",
  weight: "Poids (kg)",
  unitPrice: "Prix unitaire (€)",
  totalPrice: "Montant (€)",
  excluded: "Inclusion dans la casse",
  product: "Produit associé",
};
function display(
  value: string | null,
  field: ReceiptCorrectionChange["field"],
) {
  if (value === null) return "Non renseigné";
  if (field === "wasteDate") return value.split("-").reverse().join("/");
  if (field === "quantityUnit")
    return (
      {
        KG: "kg",
        PIECE: "pièce",
        PACK: "unité conditionnée",
        UNKNOWN: "À préciser",
      }[value] ?? value
    );
  return value;
}
export function ReceiptCorrectionCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotReceiptCorrectionController;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<
        Awaited<ReturnType<CopilotReceiptCorrectionController["open"]>>
      >(),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState<string>(),
    [saving, setSaving] = useState(false);
  const revision = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined),
    router = useRouter();
  useFocusEffect(
    useCallback(() => {
      const version = ++revision.current;
      setState(undefined);
      setReviewed(false);
      setError(undefined);
      setSaving(false);
      void controller
        .open(message)
        .then((s) => {
          if (revision.current === version) setState(s);
        })
        .catch(() => {
          if (revision.current === version)
            setError(
              "Le brouillon ou les correspondances ont changé. Synchronisez puis demandez un nouvel aperçu de correction.",
            );
        });
      return () => {
        revision.current++;
        abort.current?.abort();
      };
    }, [controller, message]),
  );
  const confirm = async () => {
    if (locked.current || !canConfirm || !reviewed || state?.status !== "READY")
      return;
    const version = revision.current,
      cancellation = new AbortController();
    locked.current = true;
    abort.current = cancellation;
    setSaving(true);
    setError(undefined);
    try {
      const next = await controller.confirm(
        message,
        state.review!.basisHash,
        reviewed,
        cancellation.signal,
      );
      if (revision.current === version) setState(next);
    } catch {
      if (revision.current === version) {
        setError(
          "La correction n’a pas été enregistrée. Relisez les valeurs actualisées avant de confirmer.",
        );
        setReviewed(false);
        const next = await controller.open(message).catch(() => undefined);
        if (revision.current === version) setState(next);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (revision.current === version) setSaving(false);
    }
  };
  const changes = state?.review?.changes ?? state?.result?.changes ?? [];
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
      <Text style={{ color: colors.forest, fontWeight: "700" }}>
        Corriger le brouillon de casse
      </Text>
      <Text>{state?.content.source.filename ?? "Ticket de casse"}</Text>
      {state ? (
        <>
          {changes.map((change, i) => (
            <View key={i} style={{ gap: 3 }}>
              <Text style={{ fontWeight: "600" }}>
                {change.lineIndex !== null
                  ? `Ligne ${change.lineIndex + 1} · `
                  : ""}
                {labels[change.field]}
              </Text>
              <Text>Avant : {display(change.before, change.field)}</Text>
              <Text>Après : {display(change.after, change.field)}</Text>
            </View>
          ))}
          {state.review?.warnings.map((warning, i) => (
            <Text key={`warning-${i}`} style={{ color: colors.critical }}>
              {warning}
            </Text>
          ))}
          <Text>
            {state.status === "COMPLETED"
              ? "Correction enregistrée dans le brouillon de cet appareil. Elle sera synchronisée lors de la publication du ticket."
              : state.status === "UNCHANGED"
                ? "Le brouillon contient déjà ces informations. Aucune modification nécessaire."
                : state.status === "READ_ONLY"
                  ? "Ce ticket est déjà publié. Ses données ne peuvent pas être réécrites."
                  : "Seuls les champs affichés seront modifiés. Cette correction ne publie pas le ticket et ne crée pas d’alias."}
          </Text>
          {state.review ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              style={{ minHeight: 44, padding: 10 }}
              onPress={() =>
                router.push({
                  pathname: "/waste-receipt/[id]",
                  params: { id: state.review!.current.receipt.id },
                })
              }
            >
              <Text
                style={{
                  color: colors.forest,
                  textDecorationLine: "underline",
                }}
              >
                Voir la photo et le ticket
              </Text>
            </Pressable>
          ) : null}
          {state.status === "READY" && canConfirm ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Switch
                  accessibilityLabel="J’ai vérifié ces corrections"
                  value={reviewed}
                  onValueChange={setReviewed}
                  disabled={saving}
                />
                <Text style={{ flex: 1 }}>J’ai vérifié ces corrections.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: saving || !reviewed,
                  busy: saving,
                }}
                disabled={saving || !reviewed}
                style={{
                  minHeight: 44,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: colors.forest,
                  opacity: saving || !reviewed ? 0.45 : 1,
                }}
                onPress={() => {
                  void confirm();
                }}
              >
                <Text
                  style={{
                    color: "white",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {saving ? "Enregistrement…" : "Confirmer les corrections"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Comparaison avec le brouillon local" />
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
