import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotPreparationProposalController } from "./preparation-proposal-controller";
import { colors } from "../design/tokens";
const date = (v: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(new Date(v + "T12:00:00Z"));
export function PreparationProposalCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotPreparationProposalController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<
      Awaited<ReturnType<CopilotPreparationProposalController["open"]>>
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
          "Le brouillon n’a pas pu être enregistré. Vérifiez les offres et la capacité TG, puis demandez un nouvel aperçu.",
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
        Préparation des TG
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            Semaine du {date(state.content.input.weekStart)}
          </Text>
          {state.content.input.patch.tgCapacity !== undefined ? (
            <Text>
              Capacité TG :{" "}
              {state.content.basis.preparation.tgCapacity ?? "Non renseignée"} →{" "}
              {state.request.input.draft.tgCapacity ?? "Non renseignée"}
            </Text>
          ) : null}
          {state.content.input.patch.note !== undefined ? (
            <View style={{ gap: 3 }}>
              <Text style={{ fontWeight: "600" }}>Note</Text>
              <Text>
                Avant : {state.content.basis.preparation.note || "Aucune"}
              </Text>
              <Text>Après : {state.request.input.draft.note || "Aucune"}</Text>
            </View>
          ) : null}
          {(state.content.input.patch.tgUpdates ?? []).map((u) => {
            const before = state.content.basis.preparation.placements.find(
              (p) => p.id === u.placementId,
            )!;
            const after = state.request.input.draft.placements.find(
              (p) => p.id === u.placementId,
            )!;
            const names = (ids: string[]) =>
              ids
                .map(
                  (id) =>
                    state.content.basis.choices.find((c) => c.id === id)
                      ?.rawProductLabel ?? "Offre indisponible",
                )
                .join(" ; ") || "Aucune offre";
            return (
              <View key={u.placementId} style={{ gap: 4 }}>
                <Text style={{ fontWeight: "600" }}>{before.label}</Text>
                {u.label !== undefined ? (
                  <Text>
                    Nom : {before.label} → {after.label}
                  </Text>
                ) : null}
                {u.theme !== undefined ? (
                  <>
                    <Text>Thème avant : {before.theme || "Non renseigné"}</Text>
                    <Text>Thème après : {after.theme || "Non renseigné"}</Text>
                  </>
                ) : null}
                {u.offerIds !== undefined ? (
                  <>
                    <Text>Offres avant : {names(before.offerIds)}</Text>
                    <Text>Offres après : {names(after.offerIds)}</Text>
                  </>
                ) : null}
              </View>
            );
          })}
          <Text>
            Les autres TG et les liens vers les idées du PDF sont conservés.
            Confirmer enregistre le brouillon ; le plan validé et l’installation
            en rayon restent inchangés.
          </Text>
          <Text>
            {state.status === "COMPLETED"
              ? "Décision enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le brouillon ou ses offres ont changé. Demandez un nouvel aperçu avant de confirmer."
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
                {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
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
