import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { storeEventLabels } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SubstituteLookupRepository } from "@/needs/lookup-repository";
import {
  substitutionPercent,
  substitutionSyncState,
} from "@/needs/substitution-details";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
const exclusionLabels = {
  UNCONFIRMED: "Relation à confirmer",
  REJECTED: "Relation explicitement rejetée",
  RELATION_SYNC_UNRESOLVED:
    "Relation en conflit ou en erreur de synchronisation",
  PRODUCT_UNAVAILABLE: "Produit inactif, absent ou à vérifier",
  NEED_UNAVAILABLE: "Besoin client inactif, absent ou à vérifier",
  OUT_OF_STOCK: "Rupture signalée sur ce candidat, non clôturée",
  EVENT_UNRESOLVED: "Signalement sur ce candidat à comparer ou à reprendre",
};
type Snapshot = Awaited<ReturnType<SubstituteLookupRepository["read"]>>;
export default function SubstituteLookupScreen() {
  const { productId } = useLocalSearchParams<{ productId?: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { status: syncStatus } = useSync(),
    repo = useMemo(() => new SubstituteLookupRepository(sqlite), [sqlite]);
  const [needId, setNeedId] = useState<string>(),
    [snapshot, setSnapshot] = useState<{
      scope: string;
      requestKey: string;
      value: Snapshot;
    }>(),
    [error, setError] = useState<{ scope: string; message: string }>(),
    [shown, setShown] = useState(10),
    [showExcluded, setShowExcluded] = useState(false),
    [showAllNeeds, setShowAllNeeds] = useState(false),
    [refresh, setRefresh] = useState(0);
  const scope = `${storeId}:${productId}:${needId ?? "all"}`;
  const requestKey = `${scope}:${refresh}`;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId && productId)
        void repo
          .read(storeId, productId, needId)
          .then((value) => {
            if (active) {
              setSnapshot({ scope, requestKey, value });
              setError(undefined);
            }
          })
          .catch(() => {
            if (active && syncStatus !== "syncing")
              setError({
                scope,
                message:
                  "La recherche locale ne peut pas être lue. Les résultats déjà affichés sont conservés.",
              });
          });
      return () => {
        active = false;
      };
    }, [repo, storeId, productId, needId, scope, syncStatus, requestKey]),
  );
  const current = snapshot?.scope === scope ? snapshot.value : undefined,
    currentError = error?.scope === scope ? error.message : undefined;
  const selectNeed = (id?: string) => {
    setNeedId(id);
    setShown(10);
    setShowExcluded(false);
  };
  return (
    <AppScreen>
      <AppHeader
        title="Trouver un remplaçant"
        subtitle={
          current?.source?.label ??
          "Relations confirmées du magasin, disponibles hors connexion."
        }
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      {currentError ? (
        <>
          <InlineAlert title="Lecture impossible" message={currentError} />
          <SecondaryButton
            label="Réessayer"
            onPress={() => setRefresh((n) => n + 1)}
          />
        </>
      ) : null}
      {!storeId || !productId ? (
        <InlineAlert
          title="Produit à sélectionner"
          message="Ouvrez cette recherche depuis la fiche d’un produit de votre magasin."
        />
      ) : !current ? (
        !currentError ? (
          <Text className="text-muted">Lecture des remplaçants locaux…</Text>
        ) : null
      ) : current.result.status === "SOURCE_UNAVAILABLE" ? (
        <InlineAlert
          title="Produit à vérifier"
          message="Le produit source doit être actif et ses éventuels conflits résolus. Sa catégorie ou son unité peuvent rester inconnues."
        />
      ) : (
        <>
          <SectionCard title="Besoin client">
            <Text className="text-muted">
              Le classement concerne la compatibilité du remplacement. La
              disponibilité doit être vérifiée sur le terrain.
            </Text>
            <SecondaryButton
              label={`${!needId ? "✓ " : ""}Tous les besoins`}
              disabled={!needId}
              onPress={() => selectNeed()}
            />
            {current.needs
              .slice(0, showAllNeeds ? current.needs.length : 8)
              .map((n) => (
                <SecondaryButton
                  key={n.id}
                  label={`${needId === n.id ? "✓ " : ""}${n.name}`}
                  disabled={needId === n.id}
                  onPress={() => selectNeed(n.id)}
                />
              ))}
            {!showAllNeeds && current.needs.length > 8 ? (
              <SecondaryButton
                label="Afficher les autres besoins"
                onPress={() => setShowAllNeeds(true)}
              />
            ) : null}
          </SectionCard>
          {!current.result.candidates.length ? (
            <InlineAlert
              title="Aucun remplaçant utilisable dans cette sélection"
              message="Aucune relation confirmée ne remplit les conditions actuelles. L’app n’invente pas de remplacement à partir d’un nom ressemblant."
            />
          ) : (
            current.result.candidates.slice(0, shown).map((c) => (
              <SectionCard
                key={c.productId}
                title={current.labels[c.productId] ?? "Produit"}
              >
                {current.identifiers[c.productId] ? (
                  <Text className="text-muted">
                    {current.identifiers[c.productId]}
                  </Text>
                ) : null}
                <Text className="text-ink">
                  Besoin principal :{" "}
                  {current.needs.find((n) => n.id === c.relation.needUnitId)
                    ?.name ?? "Besoin client"}
                </Text>
                {c.relationships.length > 1 ? (
                  <Text className="text-muted">
                    Également confirmé pour {c.relationships.length - 1}{" "}
                    autre(s) besoin(s).
                  </Text>
                ) : null}
                <Text className="text-muted">
                  {c.basis === "LEARNED"
                    ? "Score appris"
                    : "Compatibilité déclarée pour le classement"}{" "}
                  : {substitutionPercent(c.fit)} · confiance{" "}
                  {substitutionPercent(c.relation.confidence)}.
                </Text>
                <Text className="text-muted">
                  Besoin {substitutionPercent(c.relation.needCompatibility)} ·
                  usage {substitutionPercent(c.relation.usageCompatibility)} ·
                  prix {substitutionPercent(c.relation.priceCompatibility)} ·
                  conditionnement{" "}
                  {substitutionPercent(c.relation.packagingCompatibility)}.
                </Text>
                <Text className="text-muted">
                  {c.relation.evidenceCount} observation(s) informative(s) ·{" "}
                  {substitutionSyncState(c.syncState)}. La compatibilité
                  déclarée ne prouve pas un transfert de ventes.
                </Text>
                <Text className="font-semibold text-ink">
                  Disponibilité à vérifier — stock non renseigné.
                </Text>
                {c.events.map((e) => (
                  <View key={e.id} className="gap-1">
                    <Text className="text-muted">
                      Signalement magasin : {storeEventLabels[e.type]}.
                    </Text>
                    <SecondaryButton
                      label="Consulter ce signalement"
                      onPress={() =>
                        router.push({
                          pathname: "/store-event",
                          params: { id: e.id, productId: c.productId },
                        } as Href)
                      }
                    />
                  </View>
                ))}
                {c.basis === "LEARNED" ? (
                  <SecondaryButton
                    label="Comprendre le score et ses observations"
                    onPress={() =>
                      router.push({
                        pathname: "/substitution-score",
                        params: { id: c.relation.id },
                      } as Href)
                    }
                  />
                ) : null}
                <SecondaryButton
                  label="Ouvrir la fiche produit"
                  onPress={() =>
                    router.push(`/(tabs)/products/${c.productId}` as Href)
                  }
                />
              </SectionCard>
            ))
          )}
          {current.result.candidates.length > shown ? (
            <SecondaryButton
              label="Afficher les remplaçants suivants"
              onPress={() => setShown((n) => n + 10)}
            />
          ) : null}
          {current.result.excluded.length ? (
            <SectionCard title="Relations écartées">
              <SecondaryButton
                label={`${showExcluded ? "Masquer" : "Voir"} les ${current.result.excluded.length} relation(s) écartée(s)`}
                onPress={() => setShowExcluded((v) => !v)}
              />
              {showExcluded
                ? current.result.excluded.map((e) => (
                    <View key={e.relationId} className="gap-2">
                      <Text className="text-muted">
                        {current.labels[e.productId] ?? "Produit"} :{" "}
                        {exclusionLabels[e.reason]}.
                      </Text>
                      <SecondaryButton
                        label="Consulter ce produit"
                        onPress={() =>
                          router.push(`/(tabs)/products/${e.productId}` as Href)
                        }
                      />
                    </View>
                  ))
                : null}
            </SectionCard>
          ) : null}
          <Text className="text-muted">
            Données locales consultées le{" "}
            {new Date(current.result.evaluatedAt).toLocaleString("fr-FR")}. Une
            proposition ne constitue ni une validation automatique ni une action
            exécutée.
          </Text>
        </>
      )}
    </AppScreen>
  );
}
