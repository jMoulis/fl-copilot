import { catalogueSnapshotDraft } from "@fl-copilot/domain";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotCatalogueProposalController } from "./catalogue-proposal-controller";
import { colors } from "../design/tokens";
const labels: Record<string, string> = {
  label: "Nom",
  category: "Catégorie",
  nature: "Nature",
  salesUnit: "Unité de vente",
  packagingQuantity: "Quantité conditionnée",
  packagingUnit: "Unité de conditionnement",
  packagingSourceLabel: "Libellé du conditionnement",
  identifiers: "Identifiants",
  aliases: "Alias",
};
const values: Record<string, string> = {
  UNKNOWN: "À préciser",
  FRUIT: "Fruit",
  VEGETABLE: "Légume",
  OTHER: "Autre",
  BULK: "Vrac",
  PACKAGED: "Conditionné",
  G: "g",
  BAG: "sachet",
  TRAY: "barquette",
  NET: "filet",
  KG: "kg",
  PIECE: "pièce",
  PACK: "unité conditionnée",
};
function display(v: unknown): string {
  if (Array.isArray(v))
    return (
      v
        .map((e) => ("alias" in e ? e.alias : `${e.type} : ${e.value}`))
        .join(" ; ") || "Aucun"
    );
  return values[String(v)] ?? (String(v) || "Non renseigné");
}
export function CatalogueProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotCatalogueProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotCatalogueProposalController["open"]>>>();
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
          setError("La fiche ne peut pas être vérifiée sur cet appareil.");
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
          "La fiche n’a pas pu être enregistrée. Un identifiant peut déjà être utilisé, ou la fiche avoir changé. Vérifiez les informations et demandez un nouvel aperçu.",
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
        Fiche produit
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.input.action === "CREATE"
              ? "Créer un produit"
              : state.content.input.action === "RETIRE"
                ? "Retirer le produit"
                : "Modifier le produit"}{" "}
            —{" "}
            {state.content.before?.product.entity.label ??
              state.content.input.patch.label}
          </Text>
          {Object.entries(state.content.input.patch).map(([key, value]) => (
            <View key={key} style={{ gap: 3 }}>
              <Text style={{ fontWeight: "600" }}>{labels[key]}</Text>
              {state.content.before ? (
                <Text>
                  Avant :{" "}
                  {display(
                    catalogueSnapshotDraft(state.content.before)[
                      key as keyof ReturnType<typeof catalogueSnapshotDraft>
                    ],
                  )}
                </Text>
              ) : null}
              <Text>Après : {display(value)}</Text>
            </View>
          ))}
          <Text>
            {state.status === "COMPLETED"
              ? "Fiche enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "La fiche ou ses identifiants/alias ont changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les changements avant de confirmer. Le retrait conserve l’historique. Les listes affichées remplacent les identifiants ou alias actuels."}
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
                {saving ? "Enregistrement…" : "Confirmer les changements"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la fiche" />
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
