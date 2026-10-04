import { useEffect, useState } from "react";
import { useLocalDatabase } from "@/providers/database-provider";
import {
  ImportVerificationConflictRepository,
  type ImportVerificationConflict,
} from "./import-verification-conflict-repository";

export function useOpenImportVerificationConflicts(
  storeId: string | undefined,
  refreshKey: unknown,
) {
  const { sqlite } = useLocalDatabase();
  const [conflicts, setConflicts] = useState<ImportVerificationConflict[]>([]);

  useEffect(() => {
    let mounted = true;
    if (!storeId) {
      setConflicts([]);
      return () => {
        mounted = false;
      };
    }
    void new ImportVerificationConflictRepository(sqlite)
      .listOpen(storeId)
      .then((rows) => {
        if (mounted) setConflicts(rows);
      });
    return () => {
      mounted = false;
    };
  }, [refreshKey, sqlite, storeId]);

  return conflicts;
}

export function useImportVerificationConflict(
  sourceDocumentId: string | undefined,
  storeId: string | undefined,
) {
  const { sqlite } = useLocalDatabase();
  const [conflict, setConflict] = useState<ImportVerificationConflict | null>();

  useEffect(() => {
    let mounted = true;
    if (!sourceDocumentId || !storeId) {
      setConflict(null);
      return () => {
        mounted = false;
      };
    }
    void new ImportVerificationConflictRepository(sqlite)
      .getBySourceDocumentId(sourceDocumentId, storeId)
      .then((row) => {
        if (mounted) setConflict(row);
      });
    return () => {
      mounted = false;
    };
  }, [sourceDocumentId, sqlite, storeId]);

  return conflict;
}
