import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotNeedProposalController } from "./need-proposal-controller";
import { colors } from "../design/tokens";
const labels: Record<string, string> = {
  code: "Code du besoin",
  name: "Nom",
  description: "Description",
  status: "État",
  decision: "Décision",
  strength: "Force déclarée",
  primary: "Besoin principal",
  declaredConfidence: "Confiance déclarée",
  needCompatibility: "Compatibilité du besoin",
  usageCompatibility: "Compatibilité d’usage",
  priceCompatibility: "Compatibilité du prix",
  packagingCompatibility: "Compatibilité du conditionnement",
};
const values: Record<string, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  TO_REVIEW: "À examiner",
  VALIDATED: "Validée",
  REJECTED: "Refusée",
  LEARNING: "Validée, avec apprentissage",
  PROPOSED: "Proposée",
};
function display(v: unknown) {
  if (v === null || v === undefined) return "Non renseigné";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "number")
    return new Intl.NumberFormat("fr-FR", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(v);
  return values[String(v)] ?? String(v);
}
export function NeedProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotNeedProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotNeedProposalController["open"]>>>();
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
            "La proposition ne peut pas être vérifiée sur cet appareil.",
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
      const value = await controller.confirm(
        message,
        !!state?.reactivationRequired,
        cancellation.signal,
      );
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "La proposition n’a pas pu être enregistrée. Vérifiez les besoins et produits actifs, le code du besoin et les éventuels conflits ; demandez un nouvel aperçu.",
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
        Besoins clients et associations
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.input.kind === "NEED"
              ? state.content.basis.need
                ? "Modifier le besoin"
                : "Créer un besoin"
              : state.content.input.kind === "MEMBERSHIP"
                ? "Association produit / besoin"
                : "Substitution dirigée"}
          </Text>
          <Text>
            {state.content.basis.need?.name ??
              (state.content.input.kind === "NEED"
                ? state.content.input.patch.name
                : "")}
          </Text>
          {state.content.basis.product ? (
            <Text>
              {state.content.basis.product.label}
              {state.content.basis.substitute
                ? ` → ${state.content.basis.substitute.label}`
                : ""}
            </Text>
          ) : null}
          {Object.entries(state.content.input.patch).map(([key, value]) => {
            const before =
              state.content.input.kind === "NEED"
                ? state.content.basis.need
                : state.content.input.kind === "MEMBERSHIP"
                  ? state.content.basis.membership
                  : state.content.basis.substitution;
            const field =
              key === "decision"
                ? "status"
                : key === "declaredConfidence"
                  ? "confidence"
                  : key;
            return (
              <View key={key} style={{ gap: 3 }}>
                <Text style={{ fontWeight: "600" }}>{labels[key]}</Text>
                <Text>
                  Avant : {display(before?.[field as keyof typeof before])}
                </Text>
                <Text>
                  Après :{" "}
                  {display(
                    value === null && key === "declaredConfidence"
                      ? state.content.basis.membership?.confidence
                      : value,
                  )}
                </Text>
              </View>
            );
          })}
          {state.content.input.kind !== "NEED" ? (
            <Text>
              Les niveaux proposés sont des appréciations à valider, pas des
              scores appris ni une preuve de ventes transférées. Les valeurs
              apprises existantes sont conservées.
            </Text>
          ) : null}
          {state.reactivationRequired ? (
            <Text style={{ color: colors.critical }}>
              Cette relation a déjà été refusée. La réactiver est une nouvelle
              décision explicite.
            </Text>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Décision enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le besoin, un produit ou la relation a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les changements avant de confirmer. La désactivation conserve l’historique. Une substitution A vers B ne crée pas la relation inverse."}
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
                {saving
                  ? "Enregistrement…"
                  : state.reactivationRequired
                    ? "Réactiver explicitement la relation"
                    : "Confirmer les changements"}
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
