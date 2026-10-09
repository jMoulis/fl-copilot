import { OutboxRepository } from "./outbox-repository";
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
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "@/analytics/local-recomputation";
import { SourceUploadQueue } from "@/documents/source-upload-queue";
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
  const { session, withAccessToken } = useAuth();
  const hasLocalSession = Boolean(session);
  const [state, setState] = useState<Omit<SyncContextValue, "syncNow">>({
    status: "pending",
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
  });
  const service = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new MobileSyncService(
      database.sqlite,
      {
        bootstrap: (storeId) =>
          withAccessToken((token) =>
            api.bootstrapSync(
              token,
              storeId,
              undefined,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
            ),
          ),
        push: (request) =>
          withAccessToken((token) => api.pushSync(token, request)),
        pull: (storeId, cursor) =>
          withAccessToken((token) =>
            api.pullSync(
              token,
              storeId,
              cursor,
              undefined,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
              true,
            ),
          ),
      },
      {
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
        deviceId: database.deviceId,
        commercialReview: true,
        commercialVisual: true,
        commercialChoices: true,
        commercialPreparation: true,
        commercialVersions: true,
        commercialValidation: true,
        commercialPlans: true,
        commercialExecution: true,
        storeContext: true,
        needUnits: true,
        needMemberships: true,
        productSubstitutions: true,
      },
    );
  }, [database.deviceId, database.sqlite, hasLocalSession, withAccessToken]);
  const uploadQueue = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new SourceUploadQueue(database.sqlite, {
      init: (storeId, input) =>
        withAccessToken((token) => api.initSourceUpload(token, storeId, input)),
      complete: (storeId, uploadId, input) =>
        withAccessToken((token) =>
          api.completeSourceUpload(token, storeId, uploadId, input),
        ),
      verify: (storeId, sourceDocumentId, input) =>
        withAccessToken((token) =>
          api.verifyImport(token, storeId, sourceDocumentId, input),
        ),
    });
  }, [database.sqlite, hasLocalSession, withAccessToken]);
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
        await uploadQueue?.process(storeId);
        const summary = await service.sync(storeId);
        await new LocalAnalyticsRecomputationScheduler(
          database.sqlite,
          new SQLiteProductDateRecomputer(database.sqlite),
        ).process(storeId);
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
    [database.sqlite, defaultStoreId, service, uploadQueue],
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

  useEffect(() => {
    if (
      !service ||
      !defaultStoreId ||
      state.pendingCount === 0 ||
      state.status === "syncing"
    )
      return;
    const retry = setTimeout(() => {
      void syncNow(defaultStoreId);
    }, 60_000);
    return () => clearTimeout(retry);
  }, [defaultStoreId, service, state.pendingCount, state.status, syncNow]);

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
  const outboxCounts = await new OutboxRepository(database).countActive(
    storeId,
  );
  const conflictCounts = await database.getFirstAsync<{
    conflict_count: number;
  }>(
    `
        SELECT COUNT(*) AS conflict_count
        FROM sync_conflicts
        WHERE store_id = ? AND status = 'OPEN'
      `,
    storeId,
  );
  const importVerificationCounts = await database.getFirstAsync<{
    conflict_count: number;
    failed_count: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)
         FROM import_verification_conflicts
         WHERE store_id = ? AND status = 'OPEN') AS conflict_count,
        (SELECT COUNT(*)
         FROM source_documents
         WHERE store_id = ? AND sync_state = 'ERROR'
           AND remote_processing_status = 'FAILED') AS failed_count
    `,
    storeId,
    storeId,
  );
  const jobCounts = await database.getFirstAsync<{
    pending_count: number;
    failed_count: number;
  }>(
    `
      SELECT
        SUM(CASE WHEN status IN ('PENDING', 'RETRY', 'RUNNING') THEN 1 ELSE 0 END)
          AS pending_count,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)
          AS failed_count
      FROM local_jobs
      WHERE json_extract(payload_json, '$.storeId') = ?
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
    pendingCount:
      Number(outboxCounts?.pending_count ?? 0) +
      Number(jobCounts?.pending_count ?? 0),
    conflictCount:
      Number(conflictCounts?.conflict_count ?? 0) +
      Number(importVerificationCounts?.conflict_count ?? 0),
    failedCount:
      Number(outboxCounts?.failed_count ?? 0) +
      Number(jobCounts?.failed_count ?? 0) +
      Number(importVerificationCounts?.failed_count ?? 0),
    ...(inbox?.last_successful_sync_at
      ? { lastSyncedAt: inbox.last_successful_sync_at }
      : {}),
  };
}
