import { commercialOfferHref } from "../commercial/offer-navigation";
import { useEffect, useRef, useState } from "react";
import { Link, router } from "expo-router";
import { TgPresentationView } from "../commercial/tg-presentation-view";
import { reviewPreparationSurfaceShares } from "@fl-copilot/domain";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotPreparationProposalController } from "./preparation-proposal-controller";
import {
  commercialMechanismDescription,
  currentCommercialWeek,
} from "@fl-copilot/commercial-core";
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
  const [surfaceEdits, setSurfaceEdits] = useState<Record<string, number[]>>(
    {},
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false),
    alive = useRef(true),
    abort = useRef<AbortController | undefined>(undefined);
  const week = state
    ? currentCommercialWeek(
        new Date(`${state.content.input.weekStart}T12:00:00Z`),
      )
    : undefined;
  useEffect(() => {
    alive.current = true;
    let active = true;
    setState(undefined);
    setSurfaceEdits({});
    setDetailsOpen(false);
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
  const visual =
    state?.request.input.draft.placements.some((p) => p.presentation) ?? false;
  const fastPlan =
    visual &&
    !!state?.request.input.draft.placements.every((p) => p.presentation) &&
    !state.request.input.draft.offerRefs.length &&
    !state.request.input.draft.physicalAllocation;
  const confirm = async () => {
    if (locked.current || !canConfirm) return;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = visual
        ? await controller.confirm(message, cancellation.signal, {
            shares: Object.entries(surfaceEdits).map(
              ([placementId, shares]) => ({ placementId, shares }),
            ),
            retainPlan: !!fastPlan,
          })
        : await controller.confirm(message, cancellation.signal);
      if (alive.current && fastPlan && value.status === "COMPLETED")
        router.push({
          pathname: "/commercial-plan",
          params: {
            weekStart: value.request.input.draft.weekStart,
            mode: "installation",
          },
        });
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "Les choix n’ont pas pu être enregistrés. Vérifiez les offres et la capacité TG, puis demandez un nouvel aperçu.",
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
  const visualRequest =
    state && visual
      ? reviewPreparationSurfaceShares(
          state.request,
          Object.entries(surfaceEdits).map(([placementId, shares]) => ({
            placementId,
            shares,
          })),
        )
      : undefined;
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
            Semaine {week?.number} · {week?.year} · du{" "}
            {date(state.content.input.weekStart)}
          </Text>
          {visualRequest ? (
            <TgPresentationView
              placements={visualRequest.input.draft.placements}
              onSharesChange={
                state.status === "READY" && !saving && canConfirm
                  ? (id, shares) =>
                      setSurfaceEdits((previous) => ({
                        ...previous,
                        [id]: shares,
                      }))
                  : undefined
              }
            />
          ) : null}
          {visual ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              onPress={() => setDetailsOpen((v) => !v)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.forest }}>
                {detailsOpen ? "Masquer les détails" : "Sources et changements"}
              </Text>
            </Pressable>
          ) : null}
          {!visual || detailsOpen ? (
            <>
              {state.content.input.create ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontWeight: "700" }}>
                    Choix pour la semaine
                  </Text>
                  {state.content.basis.choices.length ? (
                    <Text>
                      Offres sélectionnées :{" "}
                      {state.content.basis.choices
                        .map(
                          (c) => c.rawProductLabel + " — " + c.operationLabel,
                        )
                        .join(" ; ")}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {state.content.input.patch.refreshChoiceIds ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontWeight: "700" }}>
                    Actualiser les références d’offres
                  </Text>
                  {state.content.input.patch.refreshChoiceIds.map((id) => {
                    const choice = state.content.basis.choices.find(
                      (c) => c.id === id,
                    )!;
                    const before =
                      state.content.basis.preparation!.offerRefs.find(
                        (r) => r.choiceId === id,
                      )!;
                    return (
                      <View key={id} style={{ gap: 4 }}>
                        <Text>
                          {choice.rawProductLabel} · version{" "}
                          {before.choiceVersion} → {choice.version}
                        </Text>
                        <Text>
                          {commercialMechanismDescription(choice.mechanism)} ·
                          du {date(choice.saleStart)} au {date(choice.saleEnd)}
                        </Text>
                        {choice.note ? <Text>{choice.note}</Text> : null}
                        <Link
                          href={commercialOfferHref(choice.source, choice.id)}
                          accessibilityLabel={`Consulter l’offre ${choice.rawProductLabel} et son produit associé`}
                          style={{
                            color: colors.forest,
                            textDecorationLine: "underline",
                          }}
                        >
                          Consulter l’offre et son produit associé
                        </Link>
                      </View>
                    );
                  })}
                  <Text>
                    Le brouillon utilisera ces conditions actuelles. Les
                    anciennes conditions ne sont pas disponibles dans cet
                    aperçu. Les affectations TG restent conservées sauf
                    modification indiquée ci-dessous. Aucune offre ni plan n’est
                    validé.
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
                    state.content.input.patch.offerSelection.removeChoiceIds ??
                    []
                  ).map((id) => (
                    <Text
                      key={`remove-${id}`}
                      style={{ color: colors.critical }}
                    >
                      Retirer de la sélection :{" "}
                      {state.content.basis.choices.find((c) => c.id === id)
                        ?.rawProductLabel ?? "Offre indisponible"}
                    </Text>
                  ))}
                  <Text>
                    Le retrait concerne ce brouillon. Les offres restent
                    retenues dans le magasin et les documents originaux sont
                    conservés. Les changements d’affectation aux TG sont
                    détaillés ci-dessous.
                  </Text>
                </View>
              ) : null}
              {state.content.input.patch.tgCapacity !== undefined ||
              state.content.input.create ? (
                <Text>
                  TG disponibles :{" "}
                  {state.content.basis.preparation
                    ? `${state.content.basis.preparation.tgCapacity ?? "Non renseigné"} → `
                    : ""}
                  {state.request.input.draft.tgCapacity ?? "Non renseigné"}
                </Text>
              ) : null}
              {state.content.input.patch.note !== undefined ? (
                <View style={{ gap: 3 }}>
                  <Text style={{ fontWeight: "600" }}>Note</Text>
                  {state.content.basis.preparation ? (
                    <Text>
                      Avant : {state.content.basis.preparation.note || "Aucune"}
                    </Text>
                  ) : null}
                  <Text>
                    {state.content.basis.preparation ? "Après : " : ""}
                    {state.request.input.draft.note || "Aucune"}
                  </Text>
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
                        <Text>
                          Thème avant : {before.theme || "Non renseigné"}
                        </Text>
                        <Text>
                          Thème après : {after.theme || "Non renseigné"}
                        </Text>
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
                const removed =
                  state.content.basis.preparation?.placements.find(
                    (p) => p.id === id,
                  );
                if (!removed) return null;
                const names =
                  removed.offerIds
                    .map(
                      (offerId) =>
                        state.content.basis.choices.find(
                          (c) => c.id === offerId,
                        )?.rawProductLabel ?? "Offre indisponible",
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
                    {addition.offerIds.length ? (
                      <Text>
                        Offres :{" "}
                        {addition.offerIds
                          .map(
                            (id) =>
                              state.content.basis.choices.find(
                                (c) => c.id === id,
                              )?.rawProductLabel ?? "Offre indisponible",
                          )
                          .join(" ; ")}
                      </Text>
                    ) : null}
                  </View>
                ),
              )}
            </>
          ) : null}
          <Text>
            {fastPlan
              ? "Retenir enregistre ce plan. Tu déclareras ensuite chaque TG installée, séparément."
              : "Enregistre ces choix dans le brouillon de la semaine. La validation du plan et sa réalisation en rayon restent distinctes."}
          </Text>
          <Text>
            {state.status === "COMPLETED"
              ? "Décision enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le brouillon ou ses offres ont changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les informations avant de confirmer. L’enregistrement est local, puis synchronisé."}
          </Text>
          {state.status === "COMPLETED" || state.savedWeekAvailable ? (
            <Link
              href={{
                pathname: "/commercial-plan",
                params: { weekStart: state.content.input.weekStart },
              }}
              accessibilityLabel="Voir les choix actuels de cette semaine"
              style={{
                color: colors.forest,
                fontWeight: "700",
                paddingVertical: 12,
              }}
            >
              Voir ma semaine
            </Link>
          ) : null}
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
                {saving
                  ? "Enregistrement…"
                  : fastPlan
                    ? "Retenir ces TG et ouvrir l’installation"
                    : state.content.input.patch.offerSelection?.removeChoiceIds
                          ?.length
                      ? "Confirmer les retraits et enregistrer"
                      : state.content.input.patch.tgRemovals?.length
                        ? `Confirmer le retrait de ${state.content.input.patch.tgRemovals.length} TG et enregistrer`
                        : state.content.input.patch.refreshChoiceIds
                          ? "Confirmer l’actualisation et enregistrer"
                          : state.content.input.create
                            ? "Enregistrer ces choix"
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
