import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  ScrollView,
  Text,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { explorerRange, type ExplorerPeriod } from "@fl-copilot/analytics-core";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  SecondaryButton,
} from "../components/ui";
import { ExplorerRepository } from "./explorer-repository";
import {
  ExplorerViewRepository,
  initialExplorerView,
  changeExplorerGranularity,
  shiftExplorerView,
  drillExplorerView,
  backExplorerView,
  type ExplorerView,
} from "./explorer-state";
import { ExplorerContent, ExplorerPeriodPicker } from "./explorer-view";
import { colors } from "../design/tokens";
function tradingToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export default function AnalyticsExplorerScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreExplorer
      key={`${storeId}:${ownerId}`}
      storeId={storeId}
      ownerId={ownerId}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Analyses" />
      <InlineAlert
        title="Magasin indisponible"
        message="Reconnectez-vous pour retrouver votre magasin."
      />
    </AppScreen>
  );
}
function StoreExplorer({
  storeId,
  ownerId,
}: {
  storeId: string;
  ownerId: string;
}) {
  const { sqlite } = useLocalDatabase(),
    sync = useSync(),
    repo = useMemo(() => new ExplorerRepository(sqlite), [sqlite]),
    views = useMemo(
      () => new ExplorerViewRepository(sqlite, { storeId, ownerId }),
      [sqlite, storeId, ownerId],
    );
  const [view, setView] = useState<ExplorerView>(),
    [result, setResult] = useState<{
      key: string;
      value: Awaited<ReturnType<ExplorerRepository["load"]>>;
    }>(),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [picker, setPicker] = useState(false),
    [epoch, setEpoch] = useState(0),
    [latest, setLatest] = useState<string | null>(null);
  const current = useRef(view),
    scroller = useRef<ScrollView>(null),
    writes = useRef(Promise.resolve()),
    alive = useRef(true),
    keyboard = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void (async () => {
      const date = await repo.latestDate(storeId);
      let cached: ExplorerView | null = null;
      try {
        cached = await views.read();
      } catch {
        if (active)
          setNotice(
            "La période mémorisée n’a pas pu être restaurée. Les données métier sont conservées.",
          );
      }
      if (active) {
        setLatest(date);
        const initial =
          cached ??
          initialExplorerView(
            date && date < tradingToday() ? date : tradingToday(),
          );
        current.current = initial;
        setView(initial);
      }
    })().catch(() => {
      if (active)
        setError(
          "Les analyses locales ne peuvent pas être ouvertes. Réessayez.",
        );
    });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [repo, views, storeId]);
  const save = useCallback(
    (s: ExplorerView) => {
      writes.current = writes.current
        .catch(() => undefined)
        .then(() => views.save(s))
        .catch(() => {
          if (alive.current)
            setNotice(
              "La période reste ouverte, mais sa mémorisation a échoué. Réessayez avant de fermer l’application.",
            );
        });
    },
    [views],
  );
  function change(next: ExplorerView) {
    current.current = next;
    setView(next);
    save(next);
  }
  const refreshKey = `${epoch}:${sync.pendingCount}:${sync.conflictCount}:${sync.failedCount}`;
  const refreshRef = useRef(refreshKey);
  refreshRef.current = refreshKey;
  const key = view ? JSON.stringify([view.frame.period, view.metric]) : "";
  useFocusEffect(
    useCallback(() => {
      if (!view) return;
      const g = ++generation.current;
      let active = true;
      setError(undefined);
      void Promise.all([
        repo.load(storeId, view.frame.period, view.metric, tradingToday()),
        repo.latestDate(storeId),
      ])
        .then(([value, date]) => {
          if (
            active &&
            g === generation.current &&
            refreshKey === refreshRef.current
          ) {
            setResult({ key, value });
            setLatest(date);
          }
        })
        .catch(() => {
          if (
            active &&
            g === generation.current &&
            refreshKey === refreshRef.current
          )
            setError(
              "Les chiffres locaux n’ont pas pu être relus. Les données enregistrées restent conservées.",
            );
        });
      return () => {
        active = false;
      };
    }, [view, key, repo, storeId, refreshKey]),
  );
  useEffect(() => {
    if (!view || result?.key !== key) return;
    requestAnimationFrame(() =>
      scroller.current?.scrollTo({ y: view.frame.scroll, animated: false }),
    );
  }, [view, key, result?.key]);
  useFocusEffect(
    useCallback(() => {
      const shown = Keyboard.addListener("keyboardDidShow", () => {
          keyboard.current = true;
        }),
        hidden = Keyboard.addListener("keyboardDidHide", () => {
          keyboard.current = false;
        }),
        back = BackHandler.addEventListener("hardwareBackPress", () => {
          if (keyboard.current) {
            Keyboard.dismiss();
            return true;
          }
          const s = current.current;
          if (!s?.history.length) return false;
          const next = backExplorerView(s);
          current.current = next;
          setView(next);
          save(next);
          return true;
        });
      return () => {
        shown.remove();
        hidden.remove();
        back.remove();
        const s = current.current;
        if (s) save(s);
      };
    }, [save]),
  );
  const data = result?.key === key ? result.value : undefined;
  const scroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!current.current) return;
    current.current = {
      ...current.current,
      frame: {
        ...current.current.frame,
        scroll: Math.max(0, e.nativeEvent.contentOffset.y),
      },
    };
  };
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={{
          padding: 20,
          paddingTop: 24,
          gap: 20,
          paddingBottom: 40,
        }}
        onScroll={scroll}
        scrollEventThrottle={120}
        keyboardShouldPersistTaps="handled"
      >
        <AppHeader
          title="Analyses"
          subtitle="Les chiffres de votre rayon, à votre rythme."
        >
          <SecondaryButton
            label="Magasin et synchronisation"
            onPress={() => router.push("/(tabs)/more")}
          />
        </AppHeader>
        {notice ? (
          <InlineAlert title="Contexte de navigation" message={notice} />
        ) : null}
        {error ? (
          <InlineAlert title="Lecture indisponible" message={error} />
        ) : null}
        {!view ? (
          <>
            <Text style={{ color: colors.muted }}>
              Ouverture des analyses locales…
            </Text>
            {error ? (
              <SecondaryButton
                label="Réessayer"
                onPress={() => change(initialExplorerView(tradingToday()))}
              />
            ) : null}
          </>
        ) : (
          <>
            <ExplorerContent
              view={view}
              data={data}
              syncStatus={sync.status}
              loadingError={!!error}
              onMetric={(metric) => change({ ...current.current!, metric })}
              onGranularity={(kind) =>
                change(changeExplorerGranularity(current.current!, kind))
              }
              onShift={(n) => {
                try {
                  change(shiftExplorerView(current.current!, n));
                } catch {
                  setNotice(
                    "Cette période est hors de l’historique pris en charge.",
                  );
                }
              }}
              onPick={() => setPicker(true)}
              onDrill={(date) =>
                change(drillExplorerView(current.current!, date))
              }
              onBack={() => change(backExplorerView(current.current!))}
              onRefresh={() => setEpoch((e) => e + 1)}
            />
            {latest &&
            (latest < explorerRange(view.frame.period).start ||
              latest > explorerRange(view.frame.period).end) ? (
              <SecondaryButton
                label="Revenir aux dernières données"
                onPress={() => change(initialExplorerView(latest))}
              />
            ) : null}
            <ExplorerPeriodPicker
              visible={picker}
              period={view.frame.period}
              onClose={() => setPicker(false)}
              onSelect={(period: ExplorerPeriod) => {
                const anchor = explorerRange(period).start;
                change({
                  ...current.current!,
                  frame: { period, anchor, scroll: 0 },
                  history: [],
                });
                setPicker(false);
              }}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
