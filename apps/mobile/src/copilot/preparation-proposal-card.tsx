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
          {state.content.input.create ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: "700" }}>
                Créer le brouillon de cette semaine
              </Text>
              <Text>
                Offres retenues sélectionnées :{" "}
                {state.content.basis.choices
                  .map((c) => c.rawProductLabel + " — " + c.operationLabel)
                  .join(" ; ") || "Aucune"}
              </Text>
              <Text>
                Capacité TG :{" "}
                {state.request.input.draft.tgCapacity ?? "Non renseignée"}. Ce
                brouillon n’est pas un plan validé. Les offres ne sont pas
                validées par cette création.
              </Text>
            </View>
          ) : null}
          {state.content.input.patch.offerSelection ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "700" }}>
                Offres sélectionnées pour la semaine
              </Text>
              {(
                state.content.input.patch.offerSelection.addChoiceIds ?? []
              ).map((id) => (
                <Text key={`add-${id}`}>
                  Ajouter :{" "}
                  {state.content.basis.choices.find((c) => c.id === id)
                    ?.rawProductLabel ?? "Offre indisponible"}
                  {state.content.basis.preparation?.offerRefs.some(
                    (r) => r.choiceId === id,
                  )
                    ? " (déjà sélectionnée, référence conservée)"
                    : ""}
                </Text>
              ))}
              {(
                state.content.input.patch.offerSelection.removeChoiceIds ?? []
              ).map((id) => (
                <Text key={`remove-${id}`} style={{ color: colors.critical }}>
                  Retirer de la sélection :{" "}
                  {state.content.basis.choices.find((c) => c.id === id)
                    ?.rawProductLabel ?? "Offre indisponible"}
                </Text>
              ))}
              <Text>
                Le retrait concerne ce brouillon. Les offres restent retenues
                dans le magasin et les documents originaux sont conservés. Les
                changements d’affectation aux TG sont détaillés ci-dessous.
              </Text>
            </View>
          ) : null}
          {state.content.input.patch.tgCapacity !== undefined ? (
            <Text>
              Capacité TG :{" "}
              {state.content.basis.preparation?.tgCapacity ?? "Non renseignée"}{" "}
              → {state.request.input.draft.tgCapacity ?? "Non renseignée"}
            </Text>
          ) : null}
          {state.content.input.patch.note !== undefined ? (
            <View style={{ gap: 3 }}>
              <Text style={{ fontWeight: "600" }}>Note</Text>
              <Text>
                Avant : {state.content.basis.preparation?.note || "Aucune"}
              </Text>
              <Text>Après : {state.request.input.draft.note || "Aucune"}</Text>
            </View>
          ) : null}
          {(state.content.input.patch.tgUpdates ?? []).map((u) => {
            const before = state.content.basis.preparation?.placements.find(
              (p) => p.id === u.placementId,
            );
            if (!before) return null;
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
          {(state.content.input.patch.tgRemovals ?? []).map((id) => {
            const removed = state.content.basis.preparation?.placements.find(
              (p) => p.id === id,
            );
            if (!removed) return null;
            const names =
              removed.offerIds
                .map(
                  (offerId) =>
                    state.content.basis.choices.find((c) => c.id === offerId)
                      ?.rawProductLabel ?? "Offre indisponible",
                )
                .join(" ; ") || "Aucune offre affectée";
            return (
              <View key={id} style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700", color: colors.critical }}>
                  Retirer du brouillon : {removed.label}
                </Text>
                <Text>Thème : {removed.theme || "Non renseigné"}</Text>
                <Text>
                  Offres qui ne seront plus affectées à cette TG : {names}
                </Text>
                <Text>
                  Les offres restent sélectionnées pour la semaine.{" "}
                  {removed.sourceIdea
                    ? "Le lien de cette TG vers l’idée PDF sera retiré du brouillon ; le document original et l’historique sont conservés."
                    : "L’historique du brouillon est conservé."}
                </Text>
              </View>
            );
          })}
          {(state.content.input.patch.tgAdditions ?? []).map(
            (addition, index) => (
              <View key={`addition-${index}`} style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700" }}>
                  Ajouter au brouillon : {addition.label}
                </Text>
                <Text>Thème : {addition.theme || "Non renseigné"}</Text>
                <Text>
                  Offres :{" "}
                  {addition.offerIds
                    .map(
                      (id) =>
                        state.content.basis.choices.find((c) => c.id === id)
                          ?.rawProductLabel ?? "Offre indisponible",
                    )
                    .join(" ; ") || "Aucune offre affectée"}
                </Text>
                <Text>
                  Nouvel emplacement proposé, sans lien vers une idée PDF et
                  sans installation en rayon.
                </Text>
              </View>
            ),
          )}
          <Text>
            Les TG conservées gardent leurs liens vers les idées du PDF.
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
                {saving
                  ? "Enregistrement…"
                  : state.content.input.patch.offerSelection?.removeChoiceIds
                        ?.length
                    ? "Confirmer les retraits et enregistrer"
                    : state.content.input.patch.tgRemovals?.length
                      ? `Confirmer le retrait de ${state.content.input.patch.tgRemovals.length} TG et enregistrer`
                      : state.content.input.create
                        ? "Créer le brouillon"
                        : "Enregistrer le brouillon"}
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
