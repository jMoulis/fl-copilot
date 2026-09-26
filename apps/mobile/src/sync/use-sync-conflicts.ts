import { useEffect, useState } from "react";
import { useLocalDatabase } from "@/providers/database-provider";
import { ConflictRepository, type SyncConflict } from "./conflict-repository";

export function useOpenSyncConflicts(
  storeId: string | undefined,
  refreshKey: unknown,
) {
  const { sqlite } = useLocalDatabase();
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  useEffect(() => {
    let mounted = true;
    if (!storeId) {
      setConflicts([]);
      return () => {
        mounted = false;
      };
    }
    void new ConflictRepository(sqlite).listOpen(storeId).then((rows) => {
      if (mounted) setConflicts(rows);
    });
    return () => {
      mounted = false;
    };
  }, [refreshKey, sqlite, storeId]);

  return conflicts;
}

export function useSyncConflict(id: string | undefined) {
  const { sqlite } = useLocalDatabase();
  const [conflict, setConflict] = useState<SyncConflict | null>();

  useEffect(() => {
    let mounted = true;
    if (!id) {
      setConflict(null);
      return () => {
        mounted = false;
      };
    }
    void new ConflictRepository(sqlite).getById(id).then((row) => {
      if (mounted) setConflict(row);
    });
    return () => {
      mounted = false;
    };
  }, [id, sqlite]);

  return conflict;
}
