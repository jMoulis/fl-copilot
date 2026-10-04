import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { TodaySummaryRepository, type TodaySummary } from "./today-summary";

export function useTodaySummary() {
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount, failedCount } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const [summary, setSummary] = useState<TodaySummary | null>();
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(undefined);
      setSummary(undefined);
      if (!storeId) {
        setSummary(null);
        return () => {
          active = false;
        };
      }
      const repository = new TodaySummaryRepository(sqlite);
      void repository
        .load(storeId)
        .then((next) => {
          if (active) setSummary(next);
        })
        .catch(() => {
          if (active) setError("Les indicateurs locaux n’ont pas pu être lus.");
        });
      return () => {
        active = false;
      };
    }, [conflictCount, failedCount, pendingCount, sqlite, storeId]),
  );

  return {
    loading: summary === undefined && !error,
    storeMissing: !storeId,
    summary: summary ?? null,
    error,
  };
}
