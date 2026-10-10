import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import type {
  SubstitutionEvidence,
  SubstitutionEvidenceState,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SubstitutionEvidenceRepository } from "@/needs/evidence-repository";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  evidenceStatusLabel,
  evidenceReasonLabel,
  evidenceMoney,
  evidenceVariation,
  evidenceDay,
} from "@/needs/evidence-presentation";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
export default function EvidenceDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new SubstitutionEvidenceRepository(sqlite), [sqlite]),
    scope = `${storeId}:${id}`;
  const [data, setData] = useState<{
      scope: string;
      record: SubstitutionEvidence | null;
      state?: SubstitutionEvidenceState;
      labels: Record<string, string>;
    }>(),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId && id)
        void Promise.all([
          repo.get(storeId, id),
          repo.states(storeId),
          new ProductMasterRepository(sqlite).listProducts(storeId),
        ])
          .then(([record, states, products]) => {
            if (active)
              setData({
                scope,
                record,
                state: states.find((s) => s.eventId === record?.eventId),
                labels: Object.fromEntries(
                  products.map((r) => [r.entity.id, r.entity.label]),
                ),
              });
          })
          .catch(() => {
            if (active && syncStatus !== "syncing")
              setError("La comparaison locale ne peut pas être lue.");
          });
      return () => {
        active = false;
      };
    }, [repo, sqlite, id, storeId, scope, syncStatus]),
  );
  const current = data?.scope === scope ? data : undefined,
    e = current?.record,
    stale =
      current?.state &&
      (["QUEUED", "ERROR", "NO_RELATIONS"].includes(current.state.status) ||
        (!!e && !current.state.evidenceIds.includes(e.id)));
  return (
    <AppScreen>
      <AppHeader
        title="Comprendre l’indice"
        subtitle="Une comparaison de ventes quotidiennes, sans conclusion causale."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}
      {!current ? (
        <Text className="text-muted">Lecture des données locales…</Text>
      ) : !e ? (
        <InlineAlert
          title="Indice indisponible"
          message="Cette comparaison n’est pas disponible dans le magasin actuel."
        />
      ) : (
        <>
          {stale ? (
            <InlineAlert
              title="Actualisation en attente"
              message="La comparaison précédente est conservée. De nouvelles données ou un incident de traitement nécessitent un nouveau calcul serveur."
            />
          ) : null}
          <SectionCard title={evidenceStatusLabel(e.status)}>
            <Text className="font-semibold text-ink">
              {current.labels[e.sourceProductId] ?? "Produit initial"} →{" "}
              {current.labels[e.candidateSubstituteProductId] ?? "Remplaçant"}
            </Text>
            <Text className="text-muted">
              Journées concernées :{" "}
              {e.observationDates.map(evidenceDay).join(" · ") || "À compléter"}
            </Text>
            <Text className="text-muted">{e.notes}</Text>
            <SecondaryButton
              label="Voir le signalement source"
              onPress={() =>
                router.push({
                  pathname: "/store-event",
                  params: { id: e.eventId, productId: e.sourceProductId },
                } as Href)
              }
            />
          </SectionCard>
          <SectionCard title="Faits et référence">
            <Text className="text-ink">
              Ventes sources observées : {evidenceMoney(e.actualSalesValue)}
            </Text>
            <Text className="text-ink">
              Référence comparable : {evidenceMoney(e.expectedSalesValue)}
            </Text>
            <Text className="text-ink">
              Variation : {evidenceVariation(e.observedVariationPct)}
            </Text>
            <Text className="text-muted">
              Même jour de semaine antérieur à l’événement, moyenne des
              références disponibles parmi J−7/J−14/J−21/J−28. Les jours avec
              incident ou opération déclarée sont écartés.
            </Text>
            {e.dailyComparisons.map((d) => (
              <View key={d.date} className="gap-1">
                <Text className="font-semibold text-ink">
                  {evidenceDay(d.date)} · observé{" "}
                  {evidenceMoney(d.actualSalesValue)} · référence{" "}
                  {evidenceMoney(d.expectedSalesValue)}
                </Text>
                {d.referenceDays.map((r) => (
                  <Text key={r.date} className="text-muted">
                    Référence {evidenceDay(r.date)} :{" "}
                    {evidenceMoney(r.salesValue)}
                  </Text>
                ))}
              </View>
            ))}
            <Text className="text-muted">
              {e.observationSalesIds.length} observation(s) de vente ·{" "}
              {e.referenceSalesIds.length} observation(s) de référence ·{" "}
              {e.sourceRecordIds.length} ligne(s) source traçable(s). Aucune
              quantité ou perte de volume n’est estimée.
            </Text>
          </SectionCard>
          <SectionCard title="Lecture prudente">
            <Text className="text-ink">
              {e.interpretation === "SUPPORTS_SUBSTITUTION"
                ? "Hausse compatible avec une hypothèse de substitution, sans preuve de causalité."
                : e.interpretation === "NEUTRAL"
                  ? "Cette comparaison ne conclut pas à une substitution ni à son absence."
                  : "Aucune interprétation avec les données actuelles."}
            </Text>
            <Text className="text-muted">
              Qualité de comparaison (règle v1) :{" "}
              {e.dataQuality === null
                ? "non évaluée"
                : Math.round(e.dataQuality * 100) + " %"}
              . Cet indicateur n’est pas une probabilité statistique ni la
              confiance apprise de la relation.
            </Text>
            {e.reasons.map((reason) => (
              <Text key={reason} className="text-muted">
                • {evidenceReasonLabel(reason)}
              </Text>
            ))}
            <Text className="text-muted">
              {e.concurrentCommercialOperationIds.length} contexte(s)
              commercial(aux) · {e.concurrentStoreEventIds.length}{" "}
              signalement(s) concurrent(s)
            </Text>
          </SectionCard>
          <Text className="text-muted">
            Calcul : {new Date(e.updatedAt).toLocaleString("fr-FR")} · version{" "}
            {e.version}. Les scores de substitution ne sont pas modifiés par
            cette page.
          </Text>
        </>
      )}
    </AppScreen>
  );
}
