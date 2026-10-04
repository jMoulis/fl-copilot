import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { TodaySummaryRepository, type TodaySummary } from "./today-summary";
import { visibleStoreSnapshot, type StoreSnapshot } from "./today-snapshot";

export function useTodaySummary() {
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount, failedCount } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const [snapshot, setSnapshot] =
    useState<StoreSnapshot<TodaySummary | null>>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(undefined);
      if (!storeId) {
        return () => {
          active = false;
        };
      }
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
    }, [conflictCount, failedCount, pendingCount, sqlite, storeId]),
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
