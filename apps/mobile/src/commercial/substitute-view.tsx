import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { useCallback, useMemo, useState } from "react";
import { Text, View, AppState } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import type { CommercialWeekPlan } from "@fl-copilot/domain";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { WeeklySubstituteRepository } from "./substitute-repository";
import { sourceMarginLabel } from "../needs/substitution-context";
import { substitutionPercent } from "../needs/substitution-details";
import { commercialMechanismDescription } from "./choice-presentation";
import { CommercialOriginalButton } from "./original-button";
import { formatFrenchCalendarDate } from "../dates/calendar";
type Snapshot = Awaited<ReturnType<WeeklySubstituteRepository["read"]>>;
const reviewReasons = {
  IDENTITY: "Produit ou portée à préciser",
  PERIOD: "Période à préciser",
  EVIDENCE: "Lecture source à vérifier",
  CONFLICTING_SIGNAL: "Mentions source contradictoires",
};
export function WeeklySubstitutesView({
  storeId,
  weekStart,
  plan,
}: {
  storeId: string;
  weekStart: string;
  plan?: Pick<CommercialWeekPlan, "id" | "version" | "revisionId">;
}) {
  const [day, setDay] = useState(() => currentCommercialWeek().date);
  const { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new WeeklySubstituteRepository(sqlite), [sqlite]),
    planId = plan?.id,
    planVersion = plan?.version,
    revisionId = plan?.revisionId,
    scope = `${storeId}:${weekStart}:${planId ?? "current"}:${planVersion ?? 0}:${revisionId ?? "current"}:${day}`;
  const [snapshot, setSnapshot] = useState<{
      scope: string;
      value: Snapshot;
    }>(),
    [error, setError] = useState<{ scope: string; message: string }>(),
    [shown, setShown] = useState(3),
    [showReview, setShowReview] = useState(false),
    [reviewShown, setReviewShown] = useState(10),
    [shownOverlaps, setShownOverlaps] = useState(3);
  useFocusEffect(
    useCallback(() => {
      const refresh = () => setDay(currentCommercialWeek().date);
      refresh();
      const timer = setInterval(refresh, 60000),
        sub = AppState.addEventListener("change", (state) => {
          if (state === "active") refresh();
        });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void repo
        .read(
          storeId,
          weekStart,
          planId && planVersion && revisionId
            ? { id: planId, version: planVersion, revisionId }
            : undefined,
        )
        .then((value) => {
          if (active) {
            setSnapshot({ scope, value });
            setError(undefined);
          }
        })
        .catch(() => {
          if (active && syncStatus !== "syncing")
            setError({
              scope,
              message:
                "Les candidats locaux ne peuvent pas être lus. Les résultats déjà affichés restent conservés.",
            });
        });
      return () => {
        active = false;
      };
    }, [
      repo,
      storeId,
      weekStart,
      planId,
      planVersion,
      revisionId,
      scope,
      syncStatus,
    ]),
  );
  const current = snapshot?.scope === scope ? snapshot.value : undefined,
    currentError = error?.scope === scope ? error.message : undefined;
  if ((!current && !currentError) || current?.status === "NO_PLAN") return null;
  return (
    <SectionCard
      title={
        current?.status === "READY" && current.overlaps.length
          ? "Points de vigilance du plan"
          : "Substituts potentiels"
      }
    >
      {currentError ? (
        <InlineAlert title="Lecture indisponible" message={currentError} />
      ) : null}
      {current && current.status !== "READY" ? (
        <InlineAlert
          title={
            current.status === "PAST_WEEK"
              ? "Semaine terminée"
              : "Plan ou source à revoir"
          }
          message={
            current.status === "PAST_WEEK"
              ? "Le plan reste consultable. Aucun candidat actuel n’est proposé pour une semaine terminée."
              : "La version actuelle du plan et ses sources doivent être rétablies avant de proposer des candidats. Aucun plan, produit ou signalement n’a été modifié."
          }
        />
      ) : null}
      {current?.status === "READY" ? (
        <>
          {current.overlaps.slice(0, shownOverlaps).map((overlap) => (
            <View
              key={overlap.id}
              className="gap-3 rounded-xl border border-line p-3"
            >
              <Text className="font-semibold text-ink">
                Chevauchement commercial à surveiller
              </Text>
              <Text className="text-ink">
                {current.labels[overlap.first.productId] ??
                  overlap.first.rawProductLabel}{" "}
                ·{" "}
                {current.labels[overlap.second.productId] ??
                  overlap.second.rawProductLabel}
              </Text>
              <Text className="text-muted">
                Ventes prévues communes du{" "}
                {formatFrenchCalendarDate(overlap.start)} au{" "}
                {formatFrenchCalendarDate(overlap.end)}. Les associations
                enregistrées rapprochent ces références.
              </Text>
              {[overlap.first, overlap.second].map((o) => (
                <View key={o.id} className="gap-1">
                  <Text className="text-ink">
                    {o.rawProductLabel} :{" "}
                    {commercialMechanismDescription(o.customerMechanism)}.
                  </Text>
                  <Text className="text-muted">
                    Période de l’offre : {formatFrenchCalendarDate(o.saleStart)}{" "}
                    au {formatFrenchCalendarDate(o.saleEnd)} · source page{" "}
                    {o.sourceReference.pageNumber}.
                  </Text>
                  <SecondaryButton
                    label="Ouvrir cette offre et son opération"
                    onPress={() =>
                      router.push({
                        pathname: "/commercial-operation/[id]",
                        params: {
                          id: o.operationId,
                          weekStart: current.weekStart,
                          reminderRevision: current.revisionId,
                        },
                      } as Href)
                    }
                  />
                </View>
              ))}
              {overlap.support.map((s, i) =>
                s.kind === "SHARED_NEED" ? (
                  <Text key={i} className="text-muted">
                    Besoin commun confirmé :{" "}
                    {current.needs[s.needUnitId] ?? "Besoin client"} · force{" "}
                    {substitutionPercent(s.strengths[0])} /{" "}
                    {substitutionPercent(s.strengths[1])} · confiance déclarée{" "}
                    {substitutionPercent(s.confidences[0])} /{" "}
                    {substitutionPercent(s.confidences[1])}.
                  </Text>
                ) : (
                  <View key={i} className="gap-1">
                    <Text className="text-muted">
                      Relation dirigée confirmée :{" "}
                      {current.labels[s.sourceProductId] ?? "Produit source"} →{" "}
                      {current.labels[s.substituteProductId] ?? "Remplaçant"} ·{" "}
                      {s.basis === "LEARNED"
                        ? "score appris"
                        : "compatibilité déclarée"}{" "}
                      {substitutionPercent(s.fit)} · confiance{" "}
                      {substitutionPercent(s.confidence)}.
                    </Text>
                    <SecondaryButton
                      label="Comprendre cette relation"
                      onPress={() =>
                        router.push({
                          pathname: "/substitutes",
                          params: { productId: s.sourceProductId },
                        } as Href)
                      }
                    />
                  </View>
                ),
              )}
              <Text className="text-muted">
                Point de vigilance à discuter : ces offres peuvent aussi se
                compléter. L’effet sur les ventes et la marge reste inconnu. Le
                plan ne confirme pas leur exécution et aucune offre n’est
                retirée automatiquement.
              </Text>
              <CommercialOriginalButton
                sourceDocumentId={
                  overlap.first.sourceReference.sourceDocumentId
                }
              />
              {overlap.second.sourceReference.sourceDocumentId !==
              overlap.first.sourceReference.sourceDocumentId ? (
                <CommercialOriginalButton
                  sourceDocumentId={
                    overlap.second.sourceReference.sourceDocumentId
                  }
                />
              ) : null}
            </View>
          ))}
          {current.overlaps.length > shownOverlaps ? (
            <SecondaryButton
              label="Afficher les autres chevauchements"
              onPress={() => setShownOverlaps((n) => n + 3)}
            />
          ) : null}
          <Text className="text-muted">
            Annonces de l’enseigne pour cette semaine. La disponibilité réelle
            reste à vérifier en magasin. Les candidats suivent la compatibilité
            comportementale ; leur contexte commercial est affiché séparément.
          </Text>
          {!current.items.length ? (
            <Text className="text-muted">
              Aucune tension ciblée exploitable dans les sources de ce plan.
            </Text>
          ) : null}
          {current.items.slice(0, shown).map((item) => (
            <View
              key={item.tension.id}
              className="gap-3 rounded-xl border border-line p-3"
            >
              <Text className="font-semibold text-ink">
                Tension mentionnée :{" "}
                {current.labels[item.tension.productId!] ?? item.tension.label}
              </Text>
              <Text className="text-muted">
                {item.tension.association === "VALIDATED_OFFER"
                  ? "Produit associé dans une offre validée"
                  : "Association par identifiant exact du référentiel, à vérifier sur le PDF"}{" "}
                · source page {item.tension.pageNumber}.
              </Text>
              {item.tension.signals.map((s, i) => (
                <Text selectable key={i} className="text-ink">
                  {s.rawValue}
                </Text>
              ))}
              {item.tension.planningWindow ? (
                <Text className="text-muted">
                  Vente prévue du{" "}
                  {formatFrenchCalendarDate(item.tension.planningWindow.start)}{" "}
                  au {formatFrenchCalendarDate(item.tension.planningWindow.end)}
                  .
                </Text>
              ) : (
                <Text className="text-muted">
                  Annonce rattachée à la semaine ; jours précis non déterminés.
                </Text>
              )}
              <Text className="text-muted">
                Marge source du produit concerné :{" "}
                {sourceMarginLabel(item.sourceContext.margin)}
              </Text>
              {!item.candidates.length ? (
                <InlineAlert
                  title="Aucun candidat utilisable actuellement"
                  message={
                    item.lookup.status === "SOURCE_UNAVAILABLE"
                      ? "Le produit associé ou son état de synchronisation doit être vérifié."
                      : `Aucune relation confirmée n’est utilisable. ${item.lookup.excluded.length} relation(s) écartée(s) ; la recherche détaillée explique pourquoi.`
                  }
                />
              ) : null}
              {item.candidates.slice(0, 3).map((c) => (
                <View
                  key={c.productId}
                  className="gap-2 rounded-xl bg-canvas p-3"
                >
                  <Text className="font-semibold text-ink">
                    {current.labels[c.productId] ?? "Produit candidat"}
                  </Text>
                  <Text className="text-muted">
                    Besoin :{" "}
                    {current.needs[c.relation.needUnitId] ?? "Besoin client"} ·{" "}
                    {c.basis === "LEARNED"
                      ? "score appris"
                      : "compatibilité déclarée"}{" "}
                    {substitutionPercent(c.fit)} · confiance{" "}
                    {substitutionPercent(c.relation.confidence)} ·{" "}
                    {c.relation.evidenceCount} observation(s).
                  </Text>
                  <Text className="text-muted">
                    Prix déclaré{" "}
                    {substitutionPercent(c.relation.priceCompatibility)} ·
                    conditionnement{" "}
                    {substitutionPercent(c.relation.packagingCompatibility)}.
                    Stock non renseigné, à vérifier.
                  </Text>
                  {c.events.length ? (
                    <Text className="text-muted">
                      {c.events.length} signalement(s) magasin en cours : à
                      consulter dans la recherche détaillée.
                    </Text>
                  ) : null}
                  <Text className="text-muted">
                    Marge Mercalys :{" "}
                    {sourceMarginLabel(c.commercialContext.margin)}
                  </Text>
                  <Text className="text-muted">
                    Casse non évaluée dans ce contexte. Les dates des marges
                    peuvent différer ; aucune marge future ou perte de ventes
                    n’est calculée.
                  </Text>
                  {c.commercialContext.plannedOffers.map((o) => (
                    <Text key={o.id} className="text-muted">
                      Offre prévue dans ce plan : {o.name} ·{" "}
                      {formatFrenchCalendarDate(o.start)} au{" "}
                      {formatFrenchCalendarDate(o.end)} ·{" "}
                      {commercialMechanismDescription(o.mechanism)}.
                    </Text>
                  ))}
                  {c.commercialContext.placements.length ? (
                    <Text className="text-muted">
                      TG prévues :{" "}
                      {c.commercialContext.placements
                        .map((p) => p.label)
                        .join(" · ")}
                      . Installation non confirmée par le plan.
                    </Text>
                  ) : null}
                  {c.commercialContext.otherTensions.length ? (
                    <Text className="text-danger">
                      Une tension est également mentionnée sur ce candidat dans
                      les sources du plan. Vérifiez son approvisionnement.
                    </Text>
                  ) : null}
                  <SecondaryButton
                    label="Ouvrir la fiche de ce candidat"
                    onPress={() =>
                      router.push(`/(tabs)/products/${c.productId}` as Href)
                    }
                  />
                </View>
              ))}
              <SecondaryButton
                label="Voir tous les remplaçants et les exclusions"
                onPress={() =>
                  router.push({
                    pathname: "/substitutes",
                    params: { productId: item.tension.productId! },
                  } as Href)
                }
              />
              <CommercialOriginalButton
                sourceDocumentId={item.tension.sourceDocumentId}
              />
            </View>
          ))}
          {current.items.length > shown ? (
            <SecondaryButton
              label="Afficher les autres annonces"
              onPress={() => setShown((n) => n + 3)}
            />
          ) : null}
          {current.pastOfferCount ? (
            <Text className="text-muted">
              {current.pastOfferCount} offre(s) associée(s) dont la vente prévue
              est terminée, sans proposition actuelle.
            </Text>
          ) : null}
          {current.review.length ? (
            <>
              <SecondaryButton
                label={`${showReview ? "Masquer" : "Voir"} les ${current.review.length} annonce(s) à préciser`}
                onPress={() => setShowReview((v) => !v)}
              />
              {showReview
                ? current.review.slice(0, reviewShown).map((t) => (
                    <View key={t.id} className="gap-2">
                      <Text className="text-muted">
                        {t.label} · {reviewReasons[t.reason!]}. Source page{" "}
                        {t.pageNumber}.
                      </Text>
                      {t.signals.map((s, i) => (
                        <Text selectable key={i} className="text-ink">
                          {s.rawValue}
                        </Text>
                      ))}
                      <CommercialOriginalButton
                        sourceDocumentId={t.sourceDocumentId}
                      />
                    </View>
                  ))
                : null}
              {showReview && current.review.length > reviewShown ? (
                <SecondaryButton
                  label="Afficher les autres annonces à préciser"
                  onPress={() => setReviewShown((n) => n + 10)}
                />
              ) : null}
            </>
          ) : null}
          <Text className="text-muted">
            Plan version {current.planVersion} · contexte local consulté le{" "}
            {new Date(current.evaluatedAt).toLocaleString("fr-FR")}. Aucun
            remplaçant n’est ajouté automatiquement au plan et aucune rupture
            magasin n’est créée par cette annonce.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}
