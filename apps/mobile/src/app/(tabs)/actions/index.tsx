import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import type { CommercialWeekPlan } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { CommercialPlanRepository } from "@/commercial/week-plan-repository";
import { CommercialExecutionView } from "@/commercial/execution-view";
import {
  AppScreen,
  AppHeader,
  SecondaryButton,
  InlineAlert,
  SectionCard,
  EmptyState,
} from "@/components/ui";
export default function ActionsScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    sync = useSync(),
    repo = useMemo(
      () =>
        new CommercialPlanRepository(sqlite, (s) =>
          digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
        ),
      [sqlite],
    );
  const [snapshot, setSnapshot] = useState<{
      storeId: string;
      week: string;
      plan: CommercialWeekPlan | null;
    }>(),
    [error, setError] = useState<string>();
  const week = currentCommercialWeek().start;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(undefined);
      if (storeId)
        void repo
          .get(storeId, week)
          .then((r) => {
            if (active) setSnapshot({ storeId, week, plan: r?.entity ?? null });
          })
          .catch(() => {
            if (active && sync.status !== "syncing")
              setError("Les actions locales n’ont pas pu être relues.");
          });
      return () => {
        active = false;
      };
    }, [storeId, week, repo, sync.status]),
  );
  const visible =
    snapshot && snapshot.storeId === storeId && snapshot.week === week
      ? snapshot
      : undefined;
  return (
    <AppScreen>
      <AppHeader
        title="Actions"
        subtitle="Préparer la semaine et suivre les réalisations."
      />
      <SectionCard title="Votre semaine">
        <SecondaryButton
          label="Documents et préparation commerciale"
          onPress={() => router.push("/week")}
        />
        <SecondaryButton
          label="Ouvrir le plan validé et son historique"
          onPress={() => router.push("/commercial-plan")}
        />
      </SectionCard>
      <SectionCard title="Sur le terrain">
        <SecondaryButton
          label="Casse : tickets et imports"
          onPress={() => router.push("/waste")}
        />
        <SecondaryButton
          label="Imports Mercalys"
          onPress={() => router.push("/imports")}
        />
        <SecondaryButton
          label="Magasin, synchronisation et réglages"
          onPress={() => router.push("/more")}
        />
      </SectionCard>
      {error ? (
        <InlineAlert title="Actions indisponibles" message={error} />
      ) : null}
      {!visible ? (
        <Text className="text-muted">Lecture des actions de la semaine…</Text>
      ) : visible.plan ? (
        <CommercialExecutionView
          key={visible.plan.revisionId}
          plan={visible.plan}
        />
      ) : (
        <EmptyState
          title="Aucun plan validé cette semaine"
          message="Préparez votre semaine depuis les documents ou le copilote. Une recommandation acceptée reste distincte d’une réalisation."
        />
      )}
    </AppScreen>
  );
}
