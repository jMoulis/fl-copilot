import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { AnalyticsExplorerMetric } from "@fl-copilot/domain";
import { explorerRange, type ExplorerPeriod } from "@fl-copilot/analytics-core";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { ExplorerRepository } from "../analytics/explorer-repository";
import {
  ExplorerViewRepository,
  shiftExplorerView,
  type ExplorerView,
} from "../analytics/explorer-state";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { tradingToday } from "../dates/calendar";
import { colors } from "../design/tokens";
import {
  ProductPerformanceView,
  type ProductPerformanceData,
} from "./product-performance-view";
import {
  productPerformanceView,
  applyProductPerformanceLink,
  productPerformanceHref,
} from "./product-performance-context";
/** Read-only native detail, local data and the existing Explorer engine. No recomputation or provider call. */
type ProductPerformanceProps = {
  productId: string;
  storeId: string;
  ownerId: string;
  selection?: unknown;
};
export function ProductPerformance(props: ProductPerformanceProps) {
  return (
    <ScopedProductPerformance
      key={`${props.storeId}:${props.ownerId}:${props.productId}`}
      {...props}
    />
  );
}
function ScopedProductPerformance({
  productId,
  storeId,
  ownerId,
  selection,
}: ProductPerformanceProps) {
  const { sqlite } = useLocalDatabase(),
    sync = useSync();
  const repo = useMemo(() => new ExplorerRepository(sqlite), [sqlite]);
  const views = useMemo(
    () => new ExplorerViewRepository(sqlite, { storeId, ownerId, productId }),
    [sqlite, storeId, ownerId, productId],
  );
  const [view, setView] = useState<ExplorerView>(),
    [result, setResult] = useState<{
      key: string;
      data: ProductPerformanceData;
      revision: string;
    }>(),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [epoch, refresh] = useState(0);
  const alive = useRef(false),
    current = useRef<ExplorerView | undefined>(undefined),
    writes = useRef<Promise<unknown>>(Promise.resolve()),
    handled = useRef<unknown>(undefined);
  const save = useCallback(
    (next: ExplorerView) => {
      writes.current = writes.current
        .catch(() => undefined)
        .then(() => views.save(next))
        .catch(() => {
          if (alive.current)
            setNotice(
              "La sélection reste ouverte, mais sa mémorisation a échoué. Réessayez avant de fermer l’application.",
            );
        });
    },
    [views],
  );
  useEffect(() => {
    alive.current = true;
    let active = true;
    if (current.current)
      return () => {
        alive.current = false;
      };
    void (async () => {
      let cached: ExplorerView | null = null;
      try {
        cached = await views.read();
      } catch {
        if (active)
          setNotice(
            "La sélection mémorisée ne peut pas être relue. Les chiffres locaux sont conservés.",
          );
      }
      const date = await repo.latestDate(storeId),
        today = tradingToday();
      const initial =
        cached ??
        productPerformanceView(productId, date && date < today ? date : today);
      if (active) {
        current.current = initial;
        setView(initial);
      }
    })().catch(() => {
      if (active)
        setError("Les chiffres locaux ne peuvent pas être ouverts. Réessayez.");
    });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [views, repo, storeId, productId, epoch]);
  useEffect(() => {
    if (!view || selection === undefined || selection === handled.current)
      return;
    handled.current = selection;
    try {
      const next = applyProductPerformanceLink(
        productId,
        current.current!,
        selection,
      );
      current.current = next;
      setView(next);
      save(next);
    } catch {
      setNotice(
        "Le lien d’analyse n’est pas valide pour ce produit. La sélection locale est conservée.",
      );
    }
  }, [view, selection, productId, save]);
  const key = view
    ? JSON.stringify([view.frame.period, view.frame.filters])
    : "";
  const revision = JSON.stringify([epoch, sync.lastSyncedAt ?? null]);
  useFocusEffect(
    useCallback(() => {
      if (!view) return;
      let active = true;
      setError(undefined);
      const metrics = [
        ...new Set<AnalyticsExplorerMetric>(["sales", "margin", view.metric]),
      ];
      void Promise.all(
        metrics.map(
          async (metric) =>
            [
              metric,
              await repo.load(
                storeId,
                view.frame.period,
                metric,
                tradingToday(),
                view.frame.filters,
              ),
            ] as const,
        ),
      )
        .then((values) => {
          if (active)
            setResult({ key, data: Object.fromEntries(values), revision });
        })
        .catch(() => {
          if (active)
            setError(
              "L’actualisation a échoué. Les chiffres déjà affichés restent conservés ; ils peuvent ne pas refléter les dernières modifications.",
            );
        });
      return () => {
        active = false;
      };
    }, [repo, storeId, key, view, revision]),
  );
  const change = (next: ExplorerView) => {
    current.current = next;
    setView(next);
    save(next);
  };
  if (!view)
    return (
      <>
        <Text style={{ color: colors.muted }}>
          Lecture des chiffres locaux…
        </Text>
        {error ? (
          <>
            <InlineAlert title="Lecture interrompue" message={error} />
            <SecondaryButton
              label="Réessayer"
              onPress={() => refresh((n) => n + 1)}
            />
          </>
        ) : null}
      </>
    );
  function explore(period?: ExplorerPeriod, metric?: AnalyticsExplorerMetric) {
    const next = period
      ? {
          ...view!,
          frame: {
            ...view!.frame,
            period,
            anchor: explorerRange(period).start,
          },
        }
      : view!;
    router.navigate(
      productPerformanceHref(productId, randomUUID(), next, metric),
    );
  }
  return (
    <ProductPerformanceView
      view={view}
      data={result?.key === key ? result.data : undefined}
      error={error}
      notice={notice}
      updating={!error && result?.revision !== revision}
      onMetric={(metric) => change({ ...current.current!, metric })}
      onShift={(n) => {
        try {
          change(shiftExplorerView(current.current!, n));
        } catch {
          setNotice(
            "Cette période ne peut pas être déplacée. La sélection reste conservée.",
          );
        }
      }}
      onExplore={explore}
      onScroll={(offset) => {
        if (current.current) {
          current.current = {
            ...current.current,
            frame: { ...current.current.frame, chartScroll: offset },
          };
          save(current.current);
        }
      }}
      onRefresh={() => refresh((n) => n + 1)}
    />
  );
}
