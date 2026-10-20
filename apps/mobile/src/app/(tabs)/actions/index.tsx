import { useEffect, useMemo, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { router } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { addExplorerDays } from "@fl-copilot/analytics-core";
import type { CommercialWeekPlan } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { CommercialPlanRepository } from "@/commercial/week-plan-repository";
import { CommercialExecutionView } from "@/commercial/execution-view";
import { DateSelector } from "@/components/date-selector";
import {
  AppScreen,
  BottomSheet,
  AppHeader,
  SecondaryButton,
  InlineAlert,
  SectionCard,
  EmptyState,
} from "@/components/ui";
export default function ActionsScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreActions key={`${storeId}:${ownerId}`} storeId={storeId} />
  ) : (
    <AppScreen>
      <AppHeader title="Actions" />
      <InlineAlert
        title="Aucun magasin actif"
        message="Reconnectez-vous pour retrouver les actions de votre magasin."
      />
    </AppScreen>
  );
}
function StoreActions({ storeId }: { storeId: string }) {
  const { sqlite } = useLocalDatabase(),
    sync = useSync();
  const repo = useMemo(
    () =>
      new CommercialPlanRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [week, setWeek] = useState(() => currentCommercialWeek());
  const [periodPicker, setPeriodPicker] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    week: string;
    plan: CommercialWeekPlan | null;
  }>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || sync.status === "syncing") return;
    let active = true;
    void repo
      .get(storeId, week.start)
      .then((record) => {
        if (active) {
          setSnapshot({ week: week.start, plan: record?.entity ?? null });
          setError(undefined);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Les actions locales n’ont pas pu être relues. Les déclarations déjà affichées restent conservées.",
          );
      });
    return () => {
      active = false;
    };
  }, [
    focused,
    storeId,
    week.start,
    repo,
    sync.pendingCount,
    sync.conflictCount,
    sync.status,
    retry,
  ]);
  const visible = snapshot?.week === week.start ? snapshot : undefined;
  const selected = (date: string) => {
    setWeek(currentCommercialWeek(new Date(`${date}T12:00:00Z`)));
    setError(undefined);
  };
  return (
    <AppScreen>
      <AppHeader
        compact
        title="Actions"
        subtitle="Vos tâches et décisions sur le terrain."
      />
      <View className="gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <WeekArrow
            label="Semaine précédente"
            sign="‹"
            onPress={() => selected(addExplorerDays(week.start, -7))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choisir la semaine · semaine ${week.number}, ${week.year}`}
            onPress={() => setPeriodPicker(true)}
            className="min-h-12 flex-1 items-center justify-center rounded-xl bg-surface px-2"
          >
            <Text className="text-center text-base font-semibold text-ink">
              Semaine {week.number} · {week.year}
            </Text>
          </Pressable>
          <WeekArrow
            label="Semaine suivante"
            sign="›"
            onPress={() => selected(addExplorerDays(week.start, 7))}
          />
        </View>
        <BottomSheet
          visible={periodPicker}
          title="Choisir la semaine"
          swipeToClose
          onClose={() => setPeriodPicker(false)}
        >
          <DateSelector
            value={week.start}
            label="Date dans la semaine"
            description="Choisissez une date de la semaine à consulter."
            onConfirm={(date) => {
              selected(date);
              setPeriodPicker(false);
            }}
          />
        </BottomSheet>
        {week.start !== currentCommercialWeek().start ? (
          <SecondaryButton
            label="Revenir à cette semaine"
            onPress={() => setWeek(currentCommercialWeek())}
          />
        ) : null}
      </View>
      {error ? (
        <>
          <InlineAlert title="Lecture interrompue" message={error} />
          <SecondaryButton
            label="Réessayer la lecture"
            onPress={() => setRetry((n) => n + 1)}
          />
        </>
      ) : null}
      {!visible ? (
        !error ? (
          <Text className="text-muted">Lecture des actions de la semaine…</Text>
        ) : null
      ) : visible.plan ? (
        <CommercialExecutionView key={week.start} plan={visible.plan} compact />
      ) : (
        <EmptyState
          title="Aucun plan validé cette semaine"
          message="Préparez cette semaine depuis vos documents ou avec le copilote. Une recommandation acceptée ne constitue pas une réalisation."
        />
      )}
      <SectionCard title="Préparer et consulter">
        <SecondaryButton
          label="Préparer la semaine sélectionnée"
          onPress={() =>
            router.push({
              pathname: "/week-preparation",
              params: { weekStart: week.start },
            })
          }
        />
        <SecondaryButton
          label="Plan validé et historique de cette semaine"
          onPress={() =>
            router.push({
              pathname: "/commercial-plan",
              params: { weekStart: week.start },
            })
          }
        />
        <SecondaryButton
          label="Documents commerciaux"
          onPress={() => router.push("/week")}
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
    </AppScreen>
  );
}
function WeekArrow({
  label,
  sign,
  onPress,
}: {
  label: string;
  sign: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 min-w-12 items-center justify-center rounded-xl border border-line bg-surface"
    >
      <Text className="text-2xl text-forest">{sign}</Text>
    </Pressable>
  );
}
