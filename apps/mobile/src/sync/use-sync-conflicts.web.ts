import type { SyncConflict } from "./conflict-repository";

export function useOpenSyncConflicts(
  storeId: string | undefined,
  refreshKey: unknown,
): SyncConflict[] {
  void storeId;
  void refreshKey;
  return [];
}

export function useSyncConflict(id: string | undefined) {
  void id;
  return null;
}
