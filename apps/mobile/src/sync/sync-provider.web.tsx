import { createContext, useContext, type PropsWithChildren } from "react";
import type { SyncSummary } from "./sync-service";
import type { SyncContextValue } from "./sync-provider";

const previewSummary: SyncSummary = {
  pushed: 0,
  pulled: 0,
  conflicts: 0,
  failed: 0,
  cursor: "web-preview",
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  return (
    <SyncContext.Provider
      value={{
        status: "synced",
        pendingCount: 0,
        conflictCount: 0,
        failedCount: 0,
        syncNow: async () => previewSummary,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used within SyncProvider.");
  return value;
}
