import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import { ApiClient } from "@fl-copilot/api-client";
import { useAuth } from "@/auth/auth-provider";
import { getApiBaseUrl } from "@/config/environment";
import { useLocalDatabase } from "@/providers/database-provider";
import { MobileSyncService, type SyncSummary } from "./sync-service";

interface SyncContextValue {
  syncNow(storeId?: string): Promise<SyncSummary | undefined>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  const database = useLocalDatabase();
  const { session } = useAuth();
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

  const syncNow = useCallback(
    async (storeId = defaultStoreId) => {
      if (!service || !storeId) return undefined;
      return service.sync(storeId);
    },
    [defaultStoreId, service],
  );

  useEffect(() => {
    if (service && defaultStoreId) {
      void service.sync(defaultStoreId).catch(() => undefined);
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && service && defaultStoreId) {
        void service.sync(defaultStoreId).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [defaultStoreId, service]);

  return (
    <SyncContext.Provider value={{ syncNow }}>{children}</SyncContext.Provider>
  );
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used within SyncProvider.");
  return value;
}
