import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { TodaySummaryRepository, type TodaySummary } from "./today-summary";
import { visibleStoreSnapshot, type StoreSnapshot } from "./today-snapshot";

export function useTodaySummary() {
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount, failedCount, lastSyncedAt, status } =
    useSync();
  const storeId = session?.stores[0]?.storeId;
  const [snapshot, setSnapshot] =
    useState<StoreSnapshot<TodaySummary | null>>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const visibleSnapshot = useRef(snapshot);
  visibleSnapshot.current = snapshot;
  const revision =
    status === "syncing"
      ? "syncing"
      : JSON.stringify([
          pendingCount,
          conflictCount,
          failedCount,
          lastSyncedAt,
          status,
        ]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(undefined);
      if (!storeId) {
        return () => {
          active = false;
        };
      }
      // Keep the displayed local snapshot while the existing sync pipeline writes.
      // Read once it settles, including pulls that leave all counters unchanged.
      // An initial/fresh-store visit still reads SQLite, even during sync.
      if (status === "syncing" && visibleSnapshot.current?.storeId === storeId)
        return;
      const repository = new TodaySummaryRepository(sqlite);
      void repository
        .load(storeId)
        .then((next) => {
          if (active) setSnapshot({ storeId, value: next });
        })
        .catch(() => {
          if (active) setError("Les indicateurs locaux n’ont pas pu être lus.");
        });
      return () => {
        active = false;
      };
    }, [revision, status, sqlite, storeId]),
  );

  const refresh = useCallback(async () => {
    if (!storeId || refreshing) return;
    setRefreshing(true);
    setError(undefined);
    try {
      const next = await new TodaySummaryRepository(sqlite).load(storeId);
      setSnapshot({ storeId, value: next });
    } catch {
      setError("Les indicateurs locaux n’ont pas pu être relus.");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, sqlite, storeId]);

  const summary = visibleStoreSnapshot(snapshot, storeId);

  return {
    loading: summary === undefined && !error,
    refreshing,
    storeMissing: !storeId,
    summary: summary ?? null,
    error,
    refresh,
  };
}
