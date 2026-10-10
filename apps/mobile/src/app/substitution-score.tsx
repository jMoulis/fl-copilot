import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import type { SubstitutionScoreHistory } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SubstitutionScoreRepository } from "@/needs/score-repository";
import { substitutionPercent } from "@/needs/substitution-details";
import {
  evidenceMoney,
  evidenceVariation,
} from "@/needs/evidence-presentation";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
const reasons = {
  INITIAL: "Premier calcul avec des observations",
  NEW_EVIDENCE: "Observations nouvelles ou corrigées",
  CONFIGURATION_CHANGE: "Règle de calcul révisée",
  USER_VALIDATION: "Compatibilité revue par le magasin",
};
const decisions = {
  USED: "Prise en compte",
  NOT_READY: "Données insuffisantes",
  NEUTRAL: "Indice neutre",
  DEPENDENT: "Observation non indépendante",
  NO_INFORMATION: "Information insuffisante",
};
export default function SubstitutionScoreDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new SubstitutionScoreRepository(sqlite), [sqlite]),
    scope = `${storeId}:${id}`;
  const [snapshot, setSnapshot] = useState<{
      scope: string;
      rows: SubstitutionScoreHistory[];
    }>(),
    [error, setError] = useState<string>();
  const [shown, setShown] = useState(10);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId && id)
        void repo
          .list(storeId, id)
          .then((rows) => {
            if (active) {
              setSnapshot({ scope, rows });
              setError(undefined);
            }
          })
          .catch(() => {
            if (active && syncStatus !== "syncing")
              setError(
                "L’historique local ne peut pas être lu. Les données déjà affichées sont conservées.",
              );
          });
      return () => {
        active = false;
      };
    }, [repo, storeId, id, scope, syncStatus]),
  );
  const rows = snapshot?.scope === scope ? snapshot.rows : undefined;
  return (
    <AppScreen>
      <AppHeader
        title="Pourquoi ce score ?"
        subtitle="Évolutions synchronisées, disponibles hors connexion."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      {error ? (
        <InlineAlert title="Lecture impossible" message={error} />
      ) : null}
      <SectionCard title="Une estimation prudente">
        <Text className="text-muted">
          La compatibilité déclarée reste distincte des observations. La
          confiance est limitée par les données disponibles ; elle n’est pas une
          probabilité de transfert des ventes ni une preuve de causalité.
        </Text>
      </SectionCard>
      {!rows ? (
        <Text className="text-muted">Lecture de l’historique local…</Text>
      ) : !rows.length ? (
        <InlineAlert
          title="Pas encore de calcul synchronisé"
          message="Le serveur attend des observations exploitables. Une relation validée ne suffit pas à prouver une substitution."
        />
      ) : (
        rows.slice(0, shown).map((h) => <ScoreRevision key={h.id} h={h} />)
      )}
      {rows && rows.length > shown ? (
        <SecondaryButton
          label="Afficher les évolutions précédentes"
          onPress={() => setShown((n) => n + 10)}
        />
      ) : null}
    </AppScreen>
  );
}

function ScoreRevision({ h }: { h: SubstitutionScoreHistory }) {
  const [shownEvidence, setShownEvidence] = useState(5);
  return (
    <SectionCard title={reasons[h.reason]}>
      <Text className="text-muted">
        {new Date(h.createdAt).toLocaleString("fr-FR")} · relation version{" "}
        {h.relationshipVersion}
      </Text>
      <Text className="text-ink">
        Score : {substitutionPercent(h.previous.relationshipScore)} →{" "}
        {substitutionPercent(h.next.relationshipScore)}
      </Text>
      <Text className="text-ink">
        Confiance : {substitutionPercent(h.previous.confidence)} →{" "}
        {substitutionPercent(h.next.confidence)}
      </Text>
      <Text className="text-muted">
        {h.next.evidenceCount} observation(s) informative(s) et indépendante(s)
        · règle {h.policy.version}
      </Text>
      <Text className="text-muted">
        Compatibilité au moment du calcul : besoin{" "}
        {substitutionPercent(h.compatibility.need)}, usage{" "}
        {substitutionPercent(h.compatibility.usage)}, prix{" "}
        {substitutionPercent(h.compatibility.price)}, conditionnement{" "}
        {substitutionPercent(h.compatibility.packaging)}.
      </Text>
      {h.evidence.slice(0, shownEvidence).map((e, index) => (
        <View
          key={e.evidenceId}
          className="gap-2 rounded-xl border border-line p-3"
        >
          <Text className="font-semibold text-ink">
            Indice {index + 1} · version {e.version} · {decisions[e.reason]}
          </Text>
          <Text className="text-muted">
            Ventes observées : {evidenceMoney(e.actualSalesValue)} · référence :{" "}
            {evidenceMoney(e.expectedSalesValue)} · variation :{" "}
            {evidenceVariation(e.observedVariationPct)}
          </Text>
          <Text className="text-muted">
            Qualité : {substitutionPercent(e.quality)} · force de l’indice :{" "}
            {substitutionPercent(e.strength)}. Ces valeurs sont le snapshot
            conservé lors de cette évolution.
          </Text>
          <SecondaryButton
            label="Consulter la comparaison actuelle"
            onPress={() =>
              router.push({
                pathname: "/substitution-evidence/[id]",
                params: { id: e.evidenceId },
              } as Href)
            }
          />
          <Text className="text-muted">
            La comparaison actuelle peut avoir été corrigée depuis. Sa version
            est affichée sur la page suivante.
          </Text>
        </View>
      ))}
      {h.evidence.length > shownEvidence ? (
        <SecondaryButton
          label="Afficher les indices suivants"
          onPress={() => setShownEvidence((n) => n + 5)}
        />
      ) : null}
    </SectionCard>
  );
}
