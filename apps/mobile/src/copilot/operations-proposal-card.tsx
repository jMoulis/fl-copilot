import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotOperationsProposalController } from "./operations-proposal-controller";
import { colors } from "../design/tokens";
const labels: Record<string, string> = {
  type: "Observation",
  startedAt: "Début constaté",
  endedAt: "Fin constatée",
  severity: "Importance",
  comment: "Note",
  city: "Commune",
  postalCode: "Code postal",
  schoolZone: "Zone scolaire",
  location: "Localisation",
};
const values: Record<string, string> = {
  TENSION: "Tension",
  LOW_STOCK: "Stock faible constaté",
  OUT_OF_STOCK: "Rupture constatée",
  QUALITY_ISSUE: "Problème de qualité",
  PRICE_INCREASE: "Hausse de prix constatée",
  SUPPLIER_SHORTAGE: "Pénurie fournisseur constatée",
  LOW: "Faible",
  MEDIUM: "Moyenne",
  HIGH: "Forte",
  POINT: "Point enregistré",
  CITY: "Localisation par commune",
  KEEP: "Conserver la localisation enregistrée",
};
function display(key: string, value: unknown) {
  if (value === null || value === undefined) return "Non renseigné";
  if (key === "startedAt" || key === "endedAt")
    return (
      new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(new Date(String(value))) + " (heure de Paris)"
    );
  return values[String(value)] ?? String(value);
}
export function OperationsProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotOperationsProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<
      Awaited<ReturnType<CopilotOperationsProposalController["open"]>>
    >();
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
      const value = await controller.confirm(message, cancellation.signal);
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "L’enregistrement a échoué. Vérifiez le produit, les dates ou les réglages du magasin et demandez un nouvel aperçu.",
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
        Magasin et observations terrain
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.input.kind === "SETTINGS"
              ? "Réglages du magasin"
              : state.content.input.kind === "FIELD_CLOSE"
                ? "Clôturer l’observation"
                : "Signaler une observation"}
          </Text>
          {state.content.basis.product ? (
            <Text>{state.content.basis.product.label}</Text>
          ) : null}
          {state.content.basis.event ? (
            <Text>
              {values[state.content.basis.event.type]} ·{" "}
              {display("startedAt", state.content.basis.event.startedAt)}
            </Text>
          ) : null}
          {Object.entries(state.content.input.patch).map(([key, value]) => {
            const before =
              state.content.input.kind === "SETTINGS"
                ? state.content.basis.settings
                : state.content.basis.event;
            return (
              <View key={key} style={{ gap: 3 }}>
                <Text style={{ fontWeight: "600" }}>{labels[key]}</Text>
                {before ? (
                  <Text>
                    Avant :{" "}
                    {display(
                      key,
                      key === "location"
                        ? before && "locationMode" in before
                          ? before.locationMode
                          : null
                        : before[key as keyof typeof before],
                    )}
                  </Text>
                ) : null}
                <Text>Après : {display(key, value)}</Text>
              </View>
            );
          })}
          {state.content.input.kind === "SETTINGS" ? (
            <Text>
              {state.content.basis.settings?.locationMode === "POINT" &&
              state.content.input.patch.location === "CITY"
                ? "Le point enregistré sera remplacé par la localisation par commune. Aucune nouvelle position GPS n’est capturée."
                : "Le point éventuellement enregistré reste conservé. Le chat ne lit aucune coordonnée GPS. La météo et le calendrier seront actualisés séparément."}
            </Text>
          ) : (
            <Text>
              Vous confirmez un constat terrain. Aucun stock chiffré ni effet
              sur les ventes n’est calculé par cette action.
            </Text>
          )}
          <Text>
            {state.status === "COMPLETED"
              ? "Décision enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le produit, l’observation ou les réglages ont changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les informations avant de confirmer. L’enregistrement est local, puis synchronisé."}
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
