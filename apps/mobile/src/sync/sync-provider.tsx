import { SourceOriginalTransfer } from "../documents/source-original-transfer";
import type { SourceOriginalProof } from "../documents/source-original-transfer";
import { nativeSourceOriginalFiles } from "../documents/source-original-files";
import { SourceOriginalJobs } from "../documents/source-original-jobs";
import { VisualFileCache } from "../products/visual-file-cache";
import { VisualFileJobs } from "../products/visual-file-jobs";
import {
  VisualFileTransfer,
  type VisualFileSession,
} from "../products/visual-file-transfer";
import { nativeVisualFileStorage } from "../products/visual-file-storage";
import { CommercialAnalysisRecoveryQueue } from "../documents/commercial-analysis-recovery";
import { readPendingWork, type PendingWorkGroup } from "./pending-work";
import { randomUUID } from "expo-crypto";
import { repairMercalysPublications } from "../documents/mercalys-publication-sync";
import { OutboxRepository } from "./outbox-repository";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  pendingDetails?: PendingWorkGroup[];
  pendingCount: number;
  conflictCount: number;
  failedCount: number;
  lastSyncedAt?: string;
}

export interface SyncContextValue extends LocalSyncSnapshot {
  status: SyncRuntimeStatus;
  originals?: {
    local(sourceDocumentId: string): Promise<SourceOriginalProof | null>;
    request(sourceDocumentId: string, retry?: boolean): Promise<void>;
    cancel(sourceDocumentId: string): Promise<void>;
  };
  visuals?: {
    requestPreview(assetId: string): Promise<void>;
    retry(assetId: string): Promise<void>;
  };
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
        commercialExecutionActuals: true,
        storeContext: true,
        storeLayouts: true,
        visualLibrary: true,
        physicalAllocations: true,
        needUnits: true,
        needMemberships: true,
        productSubstitutions: true,
        storeProductEvents: true,
        substitutionEvidence: true,
        substitutionScores: true,
        copilotDecisions: true,
        copilotExecutionLinks: true,
        copilotActionExecutions: true,
        copilotKnowledge: true,
        copilotHistory: true,
        mercalysPublications: true,
        mercalysRecordUpdates: true,
        copilotOwnerId: session?.user.id,
      },
    );
  }, [
    database.deviceId,
    database.sqlite,
    hasLocalSession,
    withAccessToken,
    session?.user.id,
  ]);
  const uploadQueue = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new SourceUploadQueue(database.sqlite, {
      init: (storeId, input, expectedOwnerId) =>
        withAccessToken(
          (token) => api.initSourceUpload(token, storeId, input),
          expectedOwnerId,
        ),
      complete: (storeId, uploadId, input, expectedOwnerId) =>
        withAccessToken(
          (token) => api.completeSourceUpload(token, storeId, uploadId, input),
          expectedOwnerId,
        ),
      verify: (storeId, sourceDocumentId, input) =>
        withAccessToken((token) =>
          api.verifyImport(token, storeId, sourceDocumentId, input),
        ),
    });
  }, [database.sqlite, hasLocalSession, withAccessToken]);
  const analysisRecovery = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new CommercialAnalysisRecoveryQueue(database.sqlite, {
      resume: (storeId, id, input) =>
        withAccessToken((token) =>
          api.resumeCommercialProcessing(token, storeId, id, input),
        ),
    });
  }, [database.sqlite, hasLocalSession, withAccessToken]);
  const defaultStoreId = session?.stores[0]?.storeId;
  const visualSession = useRef<VisualFileSession | null>(null);
  visualSession.current =
    defaultStoreId && session
      ? {
          storeId: defaultStoreId,
          userId: session.user.id,
          canWrite: session.stores[0]?.role === "MANAGER",
        }
      : null;
  const originalTransfer = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new SourceOriginalTransfer(
      database.sqlite,
      {
        manifest: (store, owner, id) =>
          withAccessToken(
            (token) => api.sourceOriginalManifest(token, store, id),
            owner,
          ),
        download: (store, owner, id) =>
          withAccessToken(
            (token) => api.sourceOriginalDownload(token, store, id),
            owner,
          ),
      },
      nativeSourceOriginalFiles,
      () => visualSession.current,
      randomUUID,
    );
  }, [database.sqlite, hasLocalSession, withAccessToken]);
  const originalJobs = useMemo(
    () =>
      originalTransfer
        ? new SourceOriginalJobs(
            database.sqlite,
            originalTransfer,
            () => visualSession.current,
            randomUUID,
          )
        : undefined,
    [database.sqlite, originalTransfer],
  );
  const visualJobs = useMemo(() => {
    if (!hasLocalSession) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    const transfer = new VisualFileTransfer(
      database.sqlite,
      {
        init: (store, id) =>
          withAccessToken((token) => api.initVisualFile(token, store, id)),
        complete: (store, id, upload) =>
          withAccessToken((token) =>
            api.completeVisualFile(token, store, id, upload),
          ),
        manifest: (store, id) =>
          withAccessToken((token) => api.visualFileManifest(token, store, id)),
        download: (store, manifest, variant) =>
          withAccessToken((token) =>
            api.downloadVisualFile(token, store, manifest, variant),
          ),
      },
      nativeVisualFileStorage,
      () => visualSession.current,
    );
    return new VisualFileJobs(
      database.sqlite,
      transfer,
      () => visualSession.current,
      randomUUID,
    );
  }, [database.sqlite, hasLocalSession, withAccessToken]);

  const refreshLocalState = useCallback(async () => {
    if (!defaultStoreId) return undefined;
    const scope = visualSession.current;
    if (
      !scope ||
      scope.userId !== session?.user.id ||
      scope.storeId !== defaultStoreId
    )
      return undefined;
    const snapshot = await readLocalSyncSnapshot(
      database.sqlite,
      defaultStoreId,
      session?.user.id,
    );
    if (
      !scope ||
      scope.storeId !== visualSession.current?.storeId ||
      scope.userId !== visualSession.current?.userId
    )
      return undefined;
    setState((current) => ({
      ...snapshot,
      status:
        current.status === "syncing" || current.status === "offline"
          ? current.status
          : deriveStatus(snapshot),
    }));
    return snapshot;
  }, [database.sqlite, defaultStoreId, session?.user.id]);

  const syncNow = useCallback(
    async (storeId = defaultStoreId) => {
      if (!service || !storeId) {
        setState((current) => ({ ...current, status: "offline" }));
        return undefined;
      }
      const scope = visualSession.current;
      const currentScope = () =>
        !!scope &&
        scope.storeId === visualSession.current?.storeId &&
        scope.userId === visualSession.current?.userId;
      if (
        !currentScope() ||
        scope?.userId !== session?.user.id ||
        scope?.storeId !== defaultStoreId
      )
        return undefined;
      setState((current) => ({ ...current, status: "syncing" }));
      try {
        await repairMercalysPublications(database.sqlite, storeId, randomUUID);
        await uploadQueue?.process(storeId, session?.user.id);
        if (session?.user.id)
          await analysisRecovery?.process(storeId, session.user.id);
        const summary = await service.sync(storeId);
        if (session?.user.id)
          await originalJobs?.process(storeId, session.user.id);
        if (session?.user.id)
          await visualJobs?.process(storeId, session.user.id);
        if (currentScope())
          await new VisualFileCache(database.sqlite).clean(
            storeId,
            (file) => nativeVisualFileStorage.removeCached(storeId, file),
            currentScope,
          );
        await repairMercalysPublications(database.sqlite, storeId, randomUUID);
        await new LocalAnalyticsRecomputationScheduler(
          database.sqlite,
          new SQLiteProductDateRecomputer(database.sqlite),
        ).process(storeId);
        const snapshot = await readLocalSyncSnapshot(
          database.sqlite,
          storeId,
          session?.user.id,
        );
        if (!currentScope()) return undefined;
        setState({ ...snapshot, status: deriveStatus(snapshot) });
        return summary;
      } catch (error) {
        if (!currentScope()) return undefined;
        const snapshot = await readLocalSyncSnapshot(
          database.sqlite,
          storeId,
          session?.user.id,
        );
        if (!currentScope()) return undefined;
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
    [
      database.sqlite,
      defaultStoreId,
      service,
      uploadQueue,
      analysisRecovery,
      originalJobs,
      visualJobs,
      session?.user.id,
    ],
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

  const previewWake = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => clearTimeout(previewWake.current),
    [defaultStoreId, session?.user.id, visualJobs, syncNow],
  );
  const requestVisualPreview = useCallback(
    async (assetId: string) => {
      if (!defaultStoreId || !session?.user.id || !visualJobs)
        throw Error("VISUAL_ACCESS_INVALID");
      await visualJobs.requestPreview(defaultStoreId, session.user.id, assetId);
      clearTimeout(previewWake.current);
      previewWake.current = setTimeout(() => {
        void syncNow(defaultStoreId);
      }, 150);
    },
    [defaultStoreId, session?.user.id, visualJobs, syncNow],
  );
  const retryVisual = useCallback(
    async (assetId: string) => {
      if (!defaultStoreId || !session?.user.id || !visualJobs)
        throw Error("VISUAL_ACCESS_INVALID");
      await visualJobs.retry(defaultStoreId, session.user.id, assetId);
      void syncNow(defaultStoreId);
    },
    [defaultStoreId, session?.user.id, visualJobs, syncNow],
  );
  const originals = useMemo(() => {
    if (
      !originalTransfer ||
      !originalJobs ||
      !defaultStoreId ||
      !session?.user.id
    )
      return undefined;
    const ownerId = session.user.id;
    const check = () => {
      if (
        visualSession.current?.storeId !== defaultStoreId ||
        visualSession.current.userId !== ownerId
      )
        throw Error("SOURCE_ORIGINAL_SCOPE_CHANGED");
    };
    return {
      local: async (id: string) => {
        check();
        const proof = await originalTransfer.local(id);
        check();
        return proof;
      },
      request: async (id: string, retry = false) => {
        check();
        await originalJobs.request(id, retry);
        check();
        void syncNow(defaultStoreId);
      },
      cancel: async (id: string) => {
        check();
        await originalJobs.cancel(id);
        check();
      },
    };
  }, [
    originalTransfer,
    originalJobs,
    defaultStoreId,
    session?.user.id,
    syncNow,
  ]);
  return (
    <SyncContext.Provider
      value={{
        ...state,
        syncNow,
        originals,
        visuals: { requestPreview: requestVisualPreview, retry: retryVisual },
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

function deriveStatus(snapshot: LocalSyncSnapshot): SyncRuntimeStatus {
  if (snapshot.conflictCount > 0) return "conflict";
  if (snapshot.failedCount > 0) return "error";
  if (snapshot.pendingCount > 0 || !snapshot.lastSyncedAt) return "pending";
  return "synced";
}

async function readLocalSyncSnapshot(
  database: ReturnType<typeof useLocalDatabase>["sqlite"],
  storeId: string,
  ownerId?: string,
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
        AND (CASE WHEN type IN ('COMMERCIAL_ANALYSIS_RESUME','VISUAL_FILE_TRANSFER','SOURCE_ORIGINAL_TRANSFER') OR (type='SOURCE_UPLOAD_AND_REGISTER' AND EXISTS (SELECT 1 FROM source_documents d WHERE d.id=json_extract(local_jobs.payload_json,'$.sourceDocumentId') AND d.source_type='STORE_PHOTO')) THEN json_extract(payload_json,'$.ownerId')=? ELSE 1 END)
    `,
    storeId,
    ownerId ?? null,
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
    pendingDetails: await readPendingWork(database, storeId, ownerId),
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
