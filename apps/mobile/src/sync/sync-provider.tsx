import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import { ApiClient, ApiClientError } from "@fl-copilot/api-client";
import { useAuth } from "@/auth/auth-provider";
import { getApiBaseUrl } from "@/config/environment";
import { useLocalDatabase } from "@/providers/database-provider";
import { MobileSyncService, type SyncSummary } from "./sync-service";
import { subscribeOutboxChanges } from "./outbox-repository";

export type SyncRuntimeStatus =
  "synced" | "offline" | "pending" | "syncing" | "conflict" | "error";

interface LocalSyncSnapshot {
  pendingCount: number;
  conflictCount: number;
  failedCount: number;
  lastSyncedAt?: string;
}

export interface SyncContextValue extends LocalSyncSnapshot {
  status: SyncRuntimeStatus;
  syncNow(storeId?: string): Promise<SyncSummary | undefined>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  const database = useLocalDatabase();
  const { session } = useAuth();
  const [state, setState] = useState<Omit<SyncContextValue, "syncNow">>({
    status: "pending",
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
  });
  const service = useMemo(() => {
    if (!session?.accessToken) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    const accessToken = session.accessToken;
    return new MobileSyncService(
      database.sqlite,
      {
        bootstrap: (storeId) => api.bootstrapSync(accessToken, storeId),
        push: (request) => api.pushSync(accessToken, request),
        pull: (storeId, cursor) => api.pullSync(accessToken, storeId, cursor),
      },
      {
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
        deviceId: database.deviceId,
      },
    );
  }, [database.deviceId, database.sqlite, session?.accessToken]);
  const defaultStoreId = session?.stores[0]?.storeId;

  const refreshLocalState = useCallback(async () => {
    if (!defaultStoreId) return undefined;
    const snapshot = await readLocalSyncSnapshot(
      database.sqlite,
      defaultStoreId,
    );
    setState((current) => ({
      ...snapshot,
      status:
        current.status === "syncing" || current.status === "offline"
          ? current.status
          : deriveStatus(snapshot),
    }));
    return snapshot;
  }, [database.sqlite, defaultStoreId]);

  const syncNow = useCallback(
    async (storeId = defaultStoreId) => {
      if (!service || !storeId) {
        setState((current) => ({ ...current, status: "offline" }));
        return undefined;
      }
      setState((current) => ({ ...current, status: "syncing" }));
      try {
        const summary = await service.sync(storeId);
        const snapshot = await readLocalSyncSnapshot(database.sqlite, storeId);
        setState({ ...snapshot, status: deriveStatus(snapshot) });
        return summary;
      } catch (error) {
        const snapshot = await readLocalSyncSnapshot(database.sqlite, storeId);
        setState({
          ...snapshot,
          status:
            error instanceof ApiClientError && error.status === 0
              ? "offline"
              : "error",
        });
        return undefined;
      }
    },
    [database.sqlite, defaultStoreId, service],
  );

  useEffect(() => {
    void refreshLocalState();
    const unsubscribe = subscribeOutboxChanges(() => {
      void refreshLocalState();
    });
    return unsubscribe;
  }, [refreshLocalState]);

  useEffect(() => {
    if (service && defaultStoreId) {
      void syncNow(defaultStoreId);
    } else if (defaultStoreId) {
      setState((current) => ({ ...current, status: "offline" }));
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && service && defaultStoreId) {
        void syncNow(defaultStoreId);
      }
    });
    return () => subscription.remove();
  }, [defaultStoreId, service, syncNow]);

  return (
    <SyncContext.Provider value={{ ...state, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used within SyncProvider.");
  return value;
}

function deriveStatus(snapshot: LocalSyncSnapshot): SyncRuntimeStatus {
  if (snapshot.conflictCount > 0) return "conflict";
  if (snapshot.failedCount > 0) return "error";
  if (snapshot.pendingCount > 0 || !snapshot.lastSyncedAt) return "pending";
  return "synced";
}

async function readLocalSyncSnapshot(
  database: ReturnType<typeof useLocalDatabase>["sqlite"],
  storeId: string,
): Promise<LocalSyncSnapshot> {
  const counts = await database.getFirstAsync<{
    pending_count: number;
    conflict_count: number;
    failed_count: number;
  }>(
    `
        SELECT
          SUM(CASE WHEN status IN ('PENDING', 'SYNCING') THEN 1 ELSE 0 END)
            AS pending_count,
          SUM(CASE WHEN status = 'CONFLICT' THEN 1 ELSE 0 END)
            AS conflict_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)
            AS failed_count
        FROM sync_outbox
        WHERE store_id = ?
      `,
    storeId,
  );
  const inbox = await database.getFirstAsync<{
    last_successful_sync_at: string | null;
  }>(
    `
        SELECT last_successful_sync_at
        FROM sync_inbox_state
        WHERE store_id = ?
      `,
    storeId,
  );
  return {
    pendingCount: Number(counts?.pending_count ?? 0),
    conflictCount: Number(counts?.conflict_count ?? 0),
    failedCount: Number(counts?.failed_count ?? 0),
    ...(inbox?.last_successful_sync_at
      ? { lastSyncedAt: inbox.last_successful_sync_at }
      : {}),
  };
}
