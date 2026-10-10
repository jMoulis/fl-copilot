import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SubstitutionEvidenceRepository } from "./evidence-repository";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  evidenceStatusLabel,
  evidenceMoney,
  evidenceVariation,
  evidenceDay,
} from "./evidence-presentation";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
export function EvidenceView({
  productId,
  eventId,
}: {
  productId?: string;
  eventId?: string;
}) {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new SubstitutionEvidenceRepository(sqlite), [sqlite]),
    scope = `${storeId}:${productId ?? "all"}:${eventId ?? "all"}`;
  const [data, setData] = useState<{
      scope: string;
      rows: Awaited<ReturnType<SubstitutionEvidenceRepository["list"]>>;
      states: Awaited<ReturnType<SubstitutionEvidenceRepository["states"]>>;
      labels: Record<string, string>;
    }>(),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void Promise.all([
          repo.list(storeId),
          repo.states(storeId),
          new ProductMasterRepository(sqlite).listProducts(storeId),
        ])
          .then(([rows, states, products]) => {
            if (active) {
              setData({
                scope,
                rows: rows.filter(
                  (e) =>
                    (!productId ||
                      e.sourceProductId === productId ||
                      e.candidateSubstituteProductId === productId) &&
                    (!eventId || e.eventId === eventId),
                ),
                states,
                labels: Object.fromEntries(
                  products.map((r) => [r.entity.id, r.entity.label]),
                ),
              });
              setError(undefined);
            }
          })
          .catch(() => {
            if (active && syncStatus !== "syncing")
              setError("Les comparaisons locales ne peuvent pas être lues.");
          });
      return () => {
        active = false;
      };
    }, [repo, sqlite, storeId, scope, productId, eventId, syncStatus]),
  );
  const current = data?.scope === scope ? data : undefined;
  const eventState = eventId
    ? current?.states.find((s) => s.eventId === eventId)
    : undefined;
  return (
    <SectionCard title="Indices de ventes quotidiens">
      <Text className="text-muted">
        Comparaisons déterministes, pas une preuve de causalité. Les
        signalements ouverts, journées incomplètes et références manquantes
        restent en attente.
      </Text>
      {eventState ? (
        <Text className="text-muted">
          {
            {
              QUEUED:
                "Traitement serveur planifié. La comparaison précédente reste conservée.",
              WAITING:
                "Analyse faite : les données ou la période sont à compléter.",
              READY: "Analyse quotidienne disponible.",
              NO_RELATIONS:
                "Aucune relation de remplacement déclarée pour cet événement : aucun candidat n’est inventé.",
              ERROR:
                "Traitement temporairement indisponible. Les comparaisons précédentes restent conservées.",
            }[eventState.status]
          }
        </Text>
      ) : null}
      {current ? (
        current.rows.length ? (
          current.rows.slice(0, 10).map((e) => {
            const state = current.states.find((s) => s.eventId === e.eventId),
              stale =
                !!state &&
                (["QUEUED", "ERROR", "NO_RELATIONS"].includes(state.status) ||
                  !state.evidenceIds.includes(e.id));
            return (
              <View
                key={e.id}
                className="gap-2 rounded-xl border border-line p-3"
              >
                <Text className="font-semibold text-ink">
                  {current.labels[e.sourceProductId] ?? "Produit initial"} →{" "}
                  {current.labels[e.candidateSubstituteProductId] ??
                    "Remplaçant"}
                </Text>
                <Text className="text-muted">
                  {evidenceStatusLabel(e.status)}
                  {stale
                    ? " · comparaison antérieure, actualisation en attente"
                    : ""}
                </Text>
                {e.status === "READY" ? (
                  <Text className="text-ink">
                    Ventes sources : {evidenceMoney(e.actualSalesValue)} ·
                    référence : {evidenceMoney(e.expectedSalesValue)} ·{" "}
                    {evidenceVariation(e.observedVariationPct)}
                  </Text>
                ) : null}
                <Text className="text-muted">
                  {e.observationDates.map(evidenceDay).join(" · ") ||
                    "Période à compléter"}{" "}
                  · par jour, sans prorata horaire
                </Text>
                <SecondaryButton
                  label="Comprendre cette comparaison"
                  onPress={() =>
                    router.push(`/substitution-evidence/${e.id}` as Href)
                  }
                />
              </View>
            );
          })
        ) : (
          <Text className="text-muted">
            Aucune comparaison reçue pour cette sélection. Le serveur examine
            les signalements et les relations déclarées environ toutes les
            quinze minutes ; synchronisez pour recevoir le résultat. Sans
            relation, vente quotidienne ou référence comparable, aucun chiffre
            n’est inventé.
          </Text>
        )
      ) : (
        <Text className="text-muted">Lecture des indices locaux…</Text>
      )}
      {error ? (
        <InlineAlert title="Comparaisons indisponibles" message={error} />
      ) : null}
    </SectionCard>
  );
}
