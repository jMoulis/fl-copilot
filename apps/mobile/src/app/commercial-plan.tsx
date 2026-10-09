import { CommercialExecutionView } from "@/commercial/execution-view";
import { useSync } from "@/sync/sync-provider";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import {
  commercialPlanNeedsReview,
  currentCommercialWeek,
  type CommercialPlanContext,
} from "@fl-copilot/commercial-core";
import type {
  CommercialWeekPlan,
  CommercialPlanRevision,
} from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  InlineAlert,
  EmptyState,
} from "@/components/ui";
import {
  CommercialPlanRepository,
  readCommercialPlanRevisions,
  type LocalCommercialPlan,
} from "@/commercial/week-plan-repository";
import { readWeekPlanContext } from "@/commercial/week-plan-context";
import { CommercialPlanContent } from "@/commercial/plan-content";
import { commercialPlanError } from "@/commercial/plan-presentation";
export default function CommercialPlanScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    params = useLocalSearchParams<{ weekStart?: string }>();
  const { status: syncStatus } = useSync();
  const [weekStart] = useState(
      () => params.weekStart ?? currentCommercialWeek().start,
    ),
    repo = useMemo(
      () =>
        new CommercialPlanRepository(sqlite, (s) =>
          digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
        ),
      [sqlite],
    );
  const [record, setRecord] = useState<LocalCommercialPlan | null>(),
    [context, setContext] = useState<CommercialPlanContext>(),
    [revisions, setRevisions] = useState<CommercialPlanRevision[]>([]),
    [archive, setArchive] = useState<CommercialWeekPlan>(),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void (async () => {
          const p = await repo.get(storeId, weekStart);
          if (!p) {
            if (active) setRecord(null);
            return;
          }
          const [ctx, history] = await Promise.all([
            readWeekPlanContext(sqlite, p.entity.preparation),
            readCommercialPlanRevisions(sqlite, storeId, p.entity.id),
          ]);
          if (active) {
            setRecord(p);
            setContext(ctx);
            setRevisions(history);
          }
        })().catch(() => {
          if (active && syncStatus !== "syncing")
            setError(
              "Le plan conservé ne peut pas être lu. Rouvrez cet écran.",
            );
        });
      return () => {
        active = false;
      };
    }, [repo, sqlite, storeId, weekStart, syncStatus]),
  );
  const issues =
    record && context ? commercialPlanNeedsReview(record.entity, context) : [];
  return (
    <AppScreen>
      <AppHeader
        title={
          archive
            ? `Plan archivé · version ${archive.version}`
            : "Mon plan de semaine"
        }
        subtitle="Opérations et TG validées pour le magasin. L’exécution reste à confirmer séparément."
      />
      <SecondaryButton
        label="Retour à Ma semaine"
        onPress={() => router.replace("/week")}
      />
      {error ? <InlineAlert title="Plan indisponible" message={error} /> : null}
      {record === undefined ? (
        <Text className="text-muted">Lecture du plan…</Text>
      ) : record === null ? (
        <EmptyState
          title="Aucun plan validé"
          message="Préparez la semaine, validez les offres sélectionnées, puis confirmez le plan."
        />
      ) : (
        <>
          {" "}
          {!archive ? (
            <SectionCard
              title={`Plan conservé · version ${record.entity.version}`}
            >
              <Text className="text-base text-ink">
                Validé sur cet appareil le{" "}
                {new Date(record.entity.validatedAt).toLocaleString("fr-FR")}
              </Text>
              <Text className="text-sm text-muted">
                {record.syncState === "SYNCED"
                  ? "Synchronisé"
                  : record.syncState === "CONFLICT"
                    ? "Conflit : comparez les deux plans"
                    : record.syncState === "ERROR"
                      ? "Envoi refusé : version locale conservée"
                      : "À synchroniser"}
              </Text>
              {record.syncState === "ERROR" ? (
                <InlineAlert
                  title="Synchronisation à reprendre"
                  message={commercialPlanError(
                    record.lastErrorCode ?? undefined,
                  )}
                />
              ) : null}
              {issues.length ? (
                <InlineAlert
                  title="Plan à revoir"
                  message="Le plan précédent reste conservé. Des données ont changé depuis sa validation ; préparez et confirmez une nouvelle version avant de l’utiliser."
                />
              ) : null}
              {issues.map((i, n) => (
                <Text key={n} accessibilityRole="alert" className="text-danger">
                  {i.messageFr}
                </Text>
              ))}
              <SecondaryButton
                label={
                  record.syncState === "CONFLICT"
                    ? "Comparer dans Synchronisation"
                    : "Ouvrir le brouillon pour préparer une nouvelle version"
                }
                onPress={() =>
                  router.push(
                    record.syncState === "CONFLICT"
                      ? "/sync-center"
                      : "/week-preparation",
                  )
                }
              />
            </SectionCard>
          ) : (
            <InlineAlert
              title="Version précédente"
              message="Cette version reste dans l’historique. Elle ne remplace pas le plan actuel et ne décrit pas une exécution."
            />
          )}
          <CommercialPlanContent plan={archive ?? record.entity} />
          <CommercialExecutionView plan={archive ?? record.entity} />
          <SectionCard title="Versions synchronisées du plan">
            {revisions.map((r) => (
              <SecondaryButton
                key={r.id}
                label={`Version ${r.plan.version} · ${new Date(r.plan.validatedAt).toLocaleString("fr-FR")}`}
                onPress={() => setArchive(r.plan)}
              />
            ))}
            {!revisions.length ? (
              <Text className="text-muted">
                L’historique synchronisé apparaîtra après l’envoi du plan.
              </Text>
            ) : null}
            {archive ? (
              <SecondaryButton
                label="Revenir à la version actuelle"
                onPress={() => setArchive(undefined)}
              />
            ) : null}
          </SectionCard>
        </>
      )}
    </AppScreen>
  );
}
