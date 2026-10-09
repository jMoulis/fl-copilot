import { useCallback, useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { commercialPlanNeedsReview } from "@fl-copilot/commercial-core";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import {
  CommercialPlanRepository,
  type LocalCommercialPlan,
} from "@/commercial/week-plan-repository";
import { readWeekPlanContext } from "@/commercial/week-plan-context";
import { CommercialPlanContent } from "@/commercial/plan-content";
import { OperationReminder } from "@/reminders/operation-reminder";
import {
  AppScreen,
  AppHeader,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
export default function OperationScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    params = useLocalSearchParams<{
      id: string;
      weekStart: string;
      reminderRevision?: string;
    }>(),
    { syncNow, lastSyncedAt } = useSync();
  const repo = useMemo(
    () =>
      new CommercialPlanRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [record, setRecord] = useState<LocalCommercialPlan | null>(),
    [needsReview, setNeedsReview] = useState(true),
    [error, setError] = useState<string>();
  const watchLocal = useCallback(() => {
    let active = true;
    if (!storeId || !params.weekStart) return;
    void (async () => {
      const p = await repo.get(storeId, params.weekStart);
      const issues = p
        ? commercialPlanNeedsReview(
            p.entity,
            await readWeekPlanContext(sqlite, p.entity.preparation),
          )
        : [];
      if (active) {
        setRecord(p);
        setNeedsReview(issues.length > 0);
      }
    })().catch(() => {
      if (active) setError("L’opération locale ne peut pas être lue.");
    });
    return () => {
      active = false;
    };
  }, [repo, storeId, params.weekStart, sqlite]);
  useFocusEffect(watchLocal);
  useEffect(() => {
    if (lastSyncedAt) return watchLocal();
  }, [lastSyncedAt, watchLocal]);
  const op = (
      record &&
      record.entity.storeId === storeId &&
      record.entity.weekStart === params.weekStart
        ? record
        : undefined
    )?.entity.operations.find((o) => o.id === params.id),
    changed =
      record &&
      params.reminderRevision &&
      record.entity.revisionId !== params.reminderRevision;
  return (
    <AppScreen>
      <AppHeader
        title={op?.name ?? "Opération prévue"}
        subtitle="Consultez le plan actuel avant d’agir."
      />
      <SecondaryButton
        label="Retour au plan de semaine"
        onPress={() =>
          router.replace({
            pathname: "/commercial-plan",
            params: { weekStart: params.weekStart },
          })
        }
      />
      <SecondaryButton
        label="Actualiser la synchronisation"
        onPress={() => {
          void syncNow()
            .then(async () => {
              if (storeId) {
                const p = await repo.get(storeId, params.weekStart);
                setRecord(p);
                setNeedsReview(
                  p
                    ? commercialPlanNeedsReview(
                        p.entity,
                        await readWeekPlanContext(sqlite, p.entity.preparation),
                      ).length > 0
                    : true,
                );
              }
            })
            .catch(() => setError("Le plan local reste disponible."));
        }}
      />
      {lastSyncedAt ? (
        <Text className="text-muted">
          Dernière synchronisation :{" "}
          {new Date(lastSyncedAt).toLocaleString("fr-FR")}
        </Text>
      ) : null}
      {error ? (
        <InlineAlert title="Opération à vérifier" message={error} />
      ) : null}
      {changed ? (
        <InlineAlert
          title="Version du plan modifiée"
          message="La version actuelle est affichée. Vérifiez les dates et les offres avant d’agir."
        />
      ) : null}
      {record && op ? (
        <>
          <CommercialPlanContent plan={record.entity} operationId={op.id} />
          <OperationReminder
            key={`${record.entity.revisionId}-${op.id}`}
            plan={record.entity}
            operationId={op.id}
            allowed={record.syncState === "SYNCED" && !needsReview}
          />
        </>
      ) : (
        <Text className="text-muted">
          {record === undefined
            ? "Lecture du plan local…"
            : "Cette opération n’est plus présente dans la version actuelle. Consultez le plan et les rappels à revoir."}
        </Text>
      )}
    </AppScreen>
  );
}
