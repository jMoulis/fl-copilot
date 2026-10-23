import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { router } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { addExplorerDays } from "@fl-copilot/analytics-core";
import type { CommercialWeekPlan } from "@fl-copilot/domain";
import { useAuth } from "../../../auth/auth-provider";
import { useLocalDatabase } from "../../../providers/database-provider";
import { useSync } from "../../../sync/sync-provider";
import { CommercialPlanRepository } from "../../../commercial/week-plan-repository";
import { CommercialExecutionView } from "../../../commercial/execution-view";
import {
  ActionsViewRepository,
  initialActionsView,
  type ActionsView,
} from "../../../commercial/actions-view";
import { tradingToday } from "../../../dates/calendar";
import { DetailsDisclosure } from "../../../components/dashboard";
import { DateSelector } from "../../../components/date-selector";
import {
  AppScreen,
  AppHeader,
  SecondaryButton,
  InlineAlert,
  SectionCard,
  EmptyState,
  MenuRow,
} from "../../../components/ui";
export default function ActionsScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreActions
      key={`${storeId}:${ownerId}`}
      storeId={storeId}
      ownerId={ownerId}
    />
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
function StoreActions({
  storeId,
  ownerId,
}: {
  storeId: string;
  ownerId: string;
}) {
  const { sqlite } = useLocalDatabase(),
    sync = useSync();
  const repo = useMemo(
    () =>
      new CommercialPlanRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const views = useMemo(
    () => new ActionsViewRepository(sqlite, { storeId, ownerId }),
    [sqlite, storeId, ownerId],
  );
  const [view, setView] = useState<ActionsView>();
  const [notice, setNotice] = useState<string>();
  const initialized = view !== undefined;
  const week = currentCommercialWeek(
    new Date(`${view?.weekStart ?? initialActionsView().weekStart}T12:00:00Z`),
  );
  const [snapshot, setSnapshot] = useState<{
    week: string;
    plan: CommercialWeekPlan | null;
  }>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const focused = useIsFocused();
  const displayed = useRef(snapshot);
  displayed.current = snapshot;
  const revision =
    sync.status === "syncing"
      ? "syncing"
      : JSON.stringify([
          sync.pendingCount,
          sync.conflictCount,
          sync.failedCount,
          sync.lastSyncedAt,
          sync.status,
        ]);
  useEffect(() => {
    if (!focused || initialized) return;
    let active = true;
    void views
      .read()
      .then((saved) => {
        if (active) setView(saved ?? initialActionsView());
      })
      .catch(() => {
        if (active) {
          setView(initialActionsView());
          setNotice(
            "La semaine mémorisée ne peut pas être relue. La semaine courante reste consultable ; vos actions ne sont pas modifiées.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [views, focused, initialized]);
  useEffect(() => {
    if (!focused || !initialized) return;
    if (sync.status === "syncing" && displayed.current?.week === week.start)
      return;
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
    initialized,
    storeId,
    week.start,
    repo,
    revision,
    sync.status,
    retry,
  ]);
  const change = (next: ActionsView) => {
    setView(next);
    void views
      .save(next)
      .then(() => setNotice(undefined))
      .catch(() => {
        setNotice(
          "La sélection reste affichée, mais n’a pas pu être mémorisée pour le prochain démarrage. Choisissez à nouveau la semaine ou le filtre pour réessayer.",
        );
      });
  };
  const visible = snapshot?.week === week.start ? snapshot : undefined;
  const selected = (date: string) => {
    if (!view) return;
    change({ ...view, weekStart: initialActionsView(date).weekStart });
    setError(undefined);
  };
  if (!view)
    return (
      <AppScreen>
        <AppHeader compact title="Actions" />
        <Text className="text-muted">Lecture de votre semaine…</Text>
      </AppScreen>
    );
  return (
    <AppScreen>
      <AppHeader
        compact
        title="Actions"
        subtitle="Vos tâches et décisions sur le terrain."
      />
      {notice ? (
        <InlineAlert title="Affichage conservé" message={notice} />
      ) : null}
      <View className="gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <WeekArrow
            label="Semaine précédente"
            sign="‹"
            onPress={() => selected(addExplorerDays(week.start, -7))}
          />
          <View className="flex-1">
            <DateSelector
              value={week.start}
              label="Choisir la semaine"
              triggerLabel={`Semaine ${week.number} · ${week.year}`}
              description="Choisissez une date de la semaine à consulter. Aucune déclaration n’est modifiée."
              onConfirm={selected}
            />
          </View>
          <WeekArrow
            label="Semaine suivante"
            sign="›"
            onPress={() => selected(addExplorerDays(week.start, 7))}
          />
        </View>

        {week.start !== initialActionsView().weekStart ? (
          <SecondaryButton
            label="Revenir à cette semaine"
            onPress={() => selected(tradingToday())}
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
        <CommercialExecutionView
          key={week.start}
          plan={visible.plan}
          compact
          filter={view.filter}
          onFilter={(filter) => change({ ...view, filter })}
        />
      ) : (
        <EmptyState
          title="Aucun plan validé cette semaine"
          message="Préparez cette semaine depuis vos documents ou avec le copilote. Une recommandation acceptée ne constitue pas une réalisation."
        />
      )}
      <SectionCard title="Préparer la semaine">
        <MenuRow
          title="Préparation"
          description="Offres, affiches et mises en avant de la semaine sélectionnée."
          icon="calendar-outline"
          onPress={() =>
            router.push({
              pathname: "/week-preparation",
              params: { weekStart: week.start },
            })
          }
        />
        <MenuRow
          title="Plan et historique"
          description="Retrouver les choix validés et leurs versions."
          icon="checkmark-done-outline"
          onPress={() =>
            router.push({
              pathname: "/commercial-plan",
              params: { weekStart: week.start },
            })
          }
        />
        <MenuRow
          title="Documents commerciaux"
          description="Consulter les originaux et leurs analyses."
          icon="document-text-outline"
          onPress={() => router.push("/week")}
        />
      </SectionCard>
      <DetailsDisclosure title="Casse, imports et gestion du magasin">
        <MenuRow
          title="Casse"
          description="Tickets, photos et imports de casse."
          icon="camera-outline"
          onPress={() => router.push("/waste")}
        />
        <MenuRow
          title="Imports Mercalys"
          description="Retrouver les ventes et les fichiers importés."
          icon="cloud-upload-outline"
          onPress={() => router.push("/imports")}
        />
        <MenuRow
          title="Magasin et synchronisation"
          description="Plan du rayon, réglages et modifications en attente."
          icon="settings-outline"
          onPress={() => router.push("/more")}
        />
      </DetailsDisclosure>
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
