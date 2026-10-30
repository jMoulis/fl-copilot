import { EmailDecisionRepository } from "../intake/email-decision-repository";
import type {
  EmailIntakeDecision,
  EmailIntakeBinding,
} from "@fl-copilot/sync-contracts";
import { EmailIntakeCache } from "../intake/email-intake-cache";
import {
  EmailIntakeProcessing,
  emailProcessingFormat,
} from "../intake/email-intake-processing";
import { EmailMercalysHandoff } from "../intake/email-mercalys-handoff";
import { EmailSourceHandoff } from "../intake/email-source-handoff";
import { readEmailAdmissionAuthority } from "../intake/email-processing-basis";
import { CopilotMercalysImportController } from "../copilot/mercalys-import-controller";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { EmailOriginalTransfer } from "../intake/email-original-transfer";
import {
  nativeEmailOriginalFiles,
  readNativeEmailProcessingBytes,
} from "../intake/email-original-files";
import type { EmailOriginalProof } from "../intake/email-original-transfer";
import type { EmailIntakeOriginalRequest } from "@fl-copilot/sync-contracts";
import { SourceOriginalTransfer } from "../documents/source-original-transfer";
import type {
  SourceOriginalProof,
  SourceOriginalState,
} from "../documents/source-original-transfer";
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
import { useAuth } from "../auth/auth-provider";
import { getApiBaseUrl } from "../config/environment";
import { useLocalDatabase } from "../providers/database-provider";
import {
  LocalAnalyticsRecomputationScheduler,
  SQLiteProductDateRecomputer,
} from "../analytics/local-recomputation";
import { SourceUploadQueue } from "../documents/source-upload-queue";
import { MobileSyncService, type SyncSummary } from "./sync-service";
import { subscribeOutboxChanges } from "./outbox-repository";
import { runSyncPipeline } from "./sync-pipeline";
import { captureLocalOperationFailure } from "../observability/sentry";

export type SyncRuntimeStatus =
  "synced" | "offline" | "pending" | "syncing" | "conflict" | "error";

interface LocalSyncSnapshot {
  pendingDetails?: PendingWorkGroup[];
  pendingCount: number;
  pendingCommandCount?: number;
  pendingLocalCalculationCount?: number;
  conflictCount: number;
  failedCount: number;
  lastSyncedAt?: string;
}

export interface SyncContextValue extends LocalSyncSnapshot {
  status: SyncRuntimeStatus;
  emailIntake?: {
    status(conversationId: string): Promise<boolean>;
    createBinding(
      conversationId: string,
      id: string,
      allowedSender: string,
    ): Promise<EmailIntakeBinding>;
    revokeBinding(conversationId: string, id: string): Promise<void>;
    decision(
      conversationId: string,
      receiptId: string,
    ): ReturnType<EmailDecisionRepository["get"]>;
    decide(
      input: Parameters<EmailDecisionRepository["decide"]>[0],
      retryOfActionId?: string,
    ): Promise<EmailIntakeDecision>;
    adoptDecision(conversationId: string, conflictId: string): Promise<void>;
    list(conversationId: string): ReturnType<EmailIntakeCache["list"]>;
    refresh(conversationId: string, cursor?: string): Promise<string | null>;
    refreshReceipt(ref: {
      conversationId: string;
      receiptId: string;
    }): Promise<void>;
    localOriginal(
      ref: EmailIntakeOriginalRequest,
    ): Promise<EmailOriginalProof | null>;
    requestOriginal(
      ref: EmailIntakeOriginalRequest,
      retry?: boolean,
    ): Promise<void>;
    cancelOriginal(ref: EmailIntakeOriginalRequest): Promise<void>;
    processingState(
      ref: EmailIntakeOriginalRequest,
    ): ReturnType<SourceOriginalJobs["emailProcessingState"]>;
    retryProcessing(ref: EmailIntakeOriginalRequest): Promise<void>;
    retryOriginal(ref: EmailIntakeOriginalRequest): Promise<void>;
    setPurpose(
      ref: EmailIntakeOriginalRequest,
      purpose: "WASTE_TICKET" | "STORE_PHOTO",
    ): Promise<void>;
    cancelProcessing(ref: EmailIntakeOriginalRequest): Promise<void>;
  };
  originals?: {
    state(sourceDocumentId: string): Promise<SourceOriginalState>;
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
  const emailReadSession = useRef(session);
  emailReadSession.current = session;
  const [state, setState] = useState<Omit<SyncContextValue, "syncNow">>({
    status: "pending",
    pendingCount: 0,
    pendingCommandCount: 0,
    conflictCount: 0,
    failedCount: 0,
  });
  const localAnalytics = useMemo(
    () =>
      new LocalAnalyticsRecomputationScheduler(
        database.sqlite,
        new SQLiteProductDateRecomputer(database.sqlite),
      ),
    [database.sqlite],
  );
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
              true,
              true,
              true,
            ),
          ),
        illustrationHistoryPage: (storeId, before) =>
          withAccessToken((token) =>
            api.copilotHistory(
              token,
              storeId,
              undefined,
              before,
              50,
              "LAYOUT_ILLUSTRATIONS",
            ),
          ),
        illustrationGenerationHistoryPage: (storeId, before) =>
          withAccessToken((token) =>
            api.copilotHistory(
              token,
              storeId,
              undefined,
              before,
              50,
              "LAYOUT_ILLUSTRATION_GENERATIONS",
            ),
          ),
        emailDecisionPage: (storeId, cursor) =>
          withAccessToken((token) =>
            api.emailIntakeDecisionPage(token, storeId, cursor),
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
        commercialOriginalSources: true,
        needUnits: true,
        needMemberships: true,
        productSubstitutions: true,
        storeProductEvents: true,
        substitutionEvidence: true,
        substitutionScores: true,
        copilotDecisions: true,
        layoutIllustrations: true,
        layoutIllustrationGenerations: true,
        emailIntake: true,
        emailIntakeAllowed: (storeId) =>
          emailReadSession.current?.user.id === session?.user.id &&
          emailReadSession.current?.stores.some(
            (store) => store.storeId === storeId && store.role === "MANAGER",
          ) === true,
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
  const emailCache = useMemo(
    () =>
      hasLocalSession
        ? new EmailIntakeCache(database.sqlite, () => visualSession.current)
        : undefined,
    [database.sqlite, hasLocalSession],
  );
  const emailTransfer = useMemo(() => {
    if (!emailCache) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new EmailOriginalTransfer(
      emailCache,
      {
        manifest: (store, owner, ref) =>
          withAccessToken(
            (token) => api.emailIntakeOriginalManifest(token, store, ref),
            owner,
          ),
        retry: (store, owner, input) =>
          withAccessToken(
            (token) => api.retryEmailIntakeOriginal(token, store, input),
            owner,
          ),
        download: (store, owner, ref) =>
          withAccessToken(
            (token) => api.emailIntakeOriginalDownload(token, store, ref),
            owner,
          ),
      },
      nativeEmailOriginalFiles,
    );
  }, [emailCache, withAccessToken]);
  const emailDecisions = useMemo(
    () => (emailCache ? new EmailDecisionRepository(emailCache) : undefined),
    [emailCache],
  );
  const emailProcessing = useMemo(() => {
    if (!emailCache || !emailTransfer) return undefined;
    const api = new ApiClient(getApiBaseUrl());
    return new EmailIntakeProcessing(emailCache, emailTransfer, {
      session: () => visualSession.current,
      receipt: (scope, ref) =>
        withAccessToken(
          (token) => api.emailIntakeReceipt(token, scope.storeId, ref),
          scope.ownerId,
        ),
      format: async (proof) =>
        emailProcessingFormat(
          await readNativeEmailProcessingBytes(
            proof.localUri,
            50 * 1024 * 1024,
          ),
        ),
      mercalys: new EmailMercalysHandoff(
        emailCache,
        emailTransfer,
        database.deviceId,
      ),
      media: new EmailSourceHandoff(
        emailCache,
        emailTransfer,
        database.deviceId,
      ),
      runMercalys: (message, authorize, signal) =>
        new CopilotMercalysImportController(
          database.sqlite,
          {
            storeId: message.storeId,
            ownerId: message.ownerId,
            deviceId: database.deviceId,
            canImport: true,
          },
          {
            authorize,
            id: randomUUID,
            digest: async (text) => sourceOriginalHash(text).slice(7),
            read: (uri) =>
              readNativeEmailProcessingBytes(uri, 20 * 1024 * 1024),
            checksum: async (bytes) => sourceOriginalHash(bytes),
            classify: (labels, abort) =>
              withAccessToken(
                (token) =>
                  api.importClassification(
                    token,
                    message.storeId,
                    { labels },
                    abort,
                  ),
                message.ownerId,
              ),
          },
        ).run(message, signal),
    });
  }, [
    emailCache,
    emailTransfer,
    database.deviceId,
    database.sqlite,
    withAccessToken,
  ]);
  const originalJobs = useMemo(
    () =>
      originalTransfer
        ? new SourceOriginalJobs(
            database.sqlite,
            originalTransfer,
            () => visualSession.current,
            randomUUID,
            undefined,
            emailTransfer,
            {
              process: emailProcessing
                ? (input, lease, signal) =>
                    emailProcessing.process(input, lease, signal)
                : undefined,
              allowed: () => visualSession.current?.canWrite === true,
            },
          )
        : undefined,
    [database.sqlite, originalTransfer, emailTransfer, emailProcessing],
  );
  useEffect(
    () => () => originalJobs?.interrupt(defaultStoreId, session?.user.id),
    [originalJobs, defaultStoreId, session?.user.id],
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

  const snapshotRequest = useRef(0);
  const refreshLocalState = useCallback(async () => {
    const ticket = ++snapshotRequest.current;
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
      ticket !== snapshotRequest.current ||
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
      return runSyncPipeline(
        database.sqlite,
        scope!.userId,
        storeId,
        async () => {
          if (!currentScope()) return undefined;
          snapshotRequest.current++;
          setState((current) => ({ ...current, status: "syncing" }));
          const recompute = () => localAnalytics.process(storeId);
          try {
            // Accepted local calculations never wait for an upload or network response.
            await recompute();
            if (!currentScope()) return undefined;
            // Previously accepted local work can advance even if the next network sync fails.
            if (scope && originalJobs) {
              await emailProcessing?.seed(storeId, scope.userId, originalJobs);
              await originalJobs.process(storeId, scope.userId, 10);
            }
            await repairMercalysPublications(
              database.sqlite,
              storeId,
              randomUUID,
              (reason) =>
                captureLocalOperationFailure(reason, "mercalys-repair"),
            );
            await uploadQueue?.process(storeId, session?.user.id);
            if (session?.user.id)
              await analysisRecovery?.process(storeId, session.user.id);
            const summary = await service.sync(storeId);
            if (scope && originalJobs) {
              await emailProcessing?.seed(storeId, scope.userId, originalJobs);
              await originalJobs.process(storeId, scope.userId, 10);
            }
            if (session?.user.id)
              await visualJobs?.process(storeId, session.user.id);
            if (currentScope())
              await new VisualFileCache(database.sqlite).clean(
                storeId,
                (file) => nativeVisualFileStorage.removeCached(storeId, file),
                currentScope,
              );
            await repairMercalysPublications(
              database.sqlite,
              storeId,
              randomUUID,
              (reason) =>
                captureLocalOperationFailure(reason, "mercalys-repair"),
            );
            await recompute();
            snapshotRequest.current++;
            const snapshot = await readLocalSyncSnapshot(
              database.sqlite,
              storeId,
              session?.user.id,
            );
            if (!currentScope()) return undefined;
            setState({ ...snapshot, status: deriveStatus(snapshot) });
            return summary;
          } catch (error) {
            captureLocalOperationFailure(error, "synchronization");
            if (!currentScope()) return undefined;
            snapshotRequest.current++;
            const snapshot = await readLocalSyncSnapshot(
              database.sqlite,
              storeId,
              session?.user.id,
            );
            if (!currentScope()) return undefined;
            setState({
              ...snapshot,
              status:
                error instanceof ApiClientError &&
                error.status === 0 &&
                error.response.code !== "SYNC_REQUEST_TIMEOUT"
                  ? "offline"
                  : "error",
            });
            return undefined;
          }
        },
      );
    },
    [
      database.sqlite,
      defaultStoreId,
      service,
      localAnalytics,
      uploadQueue,
      analysisRecovery,
      originalJobs,
      emailProcessing,
      visualJobs,
      session?.user.id,
    ],
  );

  useEffect(() => {
    if (!defaultStoreId || !hasLocalSession) return;
    void localAnalytics.process(defaultStoreId).catch((error) => {
      captureLocalOperationFailure(error, "synchronization");
    });
  }, [
    localAnalytics,
    defaultStoreId,
    hasLocalSession,
    state.pendingLocalCalculationCount,
    state.pendingDetails,
  ]);

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
      state: async (id: string) => {
        check();
        const state = await originalTransfer.state(id);
        check();
        return state;
      },
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
  const emailIntake = useMemo(() => {
    if (
      !emailCache ||
      !emailDecisions ||
      !emailTransfer ||
      !originalJobs ||
      !defaultStoreId ||
      !session?.user.id
    )
      return undefined;
    const owner = session.user.id;
    const scopeFor = (conversationId: string) => {
      const scope = emailCache.scope(conversationId);
      if (scope.storeId !== defaultStoreId || scope.ownerId !== owner)
        throw Error("EMAIL_INTAKE_SCOPE_CHANGED");
      return scope;
    };
    const api = new ApiClient(getApiBaseUrl());
    const queueOriginalRetry = async (ref: EmailIntakeOriginalRequest) => {
      const scope = scopeFor(ref.conversationId);
      const receipt = await emailCache.receipt(
        ref.conversationId,
        ref.receiptId,
      );
      const file = receipt?.files.find((file) => file.id === ref.fileId);
      if (
        !receipt ||
        ["DISMISSED", "QUARANTINED"].includes(receipt.status) ||
        !file
      )
        throw Error("EMAIL_ORIGINAL_UNAVAILABLE");
      const accepted = await emailDecisions.get(
        ref.conversationId,
        ref.receiptId,
      );
      const selected = accepted?.decision.files.find(
        (file) => file.fileId === ref.fileId,
      );
      let resume:
        { fileId: string; actionId: string; processingId: string } | undefined;
      if (
        accepted?.state === "SYNCED" &&
        accepted.decision.choice === "ADMIT" &&
        selected
      ) {
        const leader = receipt.files.find((member) =>
          accepted.decision.files.some(
            (selection) =>
              selection.fileId === member.id &&
              selection.processingId === selected.processingId,
          ),
        );
        if (!leader) throw Error("EMAIL_INTAKE_IDENTITY_INVALID");
        resume = {
          fileId: leader.id,
          actionId: accepted.decision.actionId,
          processingId: selected.processingId,
        };
        await readEmailAdmissionAuthority(database.sqlite, scope, {
          receiptId: ref.receiptId,
          ...resume,
        });
      }
      await emailCache.authorize(scope);
      await originalJobs.requestEmailRetry(
        { ...ref, actionId: randomUUID() },
        resume,
      );
      emailCache.check(scope);
    };
    const processingInput = async (ref: EmailIntakeOriginalRequest) => {
      const scope = scopeFor(ref.conversationId);
      await emailCache.authorize(scope);
      const accepted = await emailDecisions.get(
        ref.conversationId,
        ref.receiptId,
      );
      const file = accepted?.decision.files.find(
        (file) => file.fileId === ref.fileId,
      );
      if (!accepted || !file) throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
      await readEmailAdmissionAuthority(database.sqlite, scope, {
        ...ref,
        actionId: accepted.decision.actionId,
        processingId: file.processingId,
      });
      await emailCache.authorize(scope);
      return {
        ...ref,
        actionId: accepted.decision.actionId,
        processingId: file.processingId,
      };
    };
    return {
      status: async (conversationId: string) => {
        const scope = scopeFor(conversationId);
        await emailCache.authorize(scope);
        const result = await withAccessToken(
          (token) => api.emailIntakeStatus(token, scope.storeId),
          owner,
        );
        await emailCache.authorize(scope);
        return result.enabled;
      },
      createBinding: async (
        conversationId: string,
        id: string,
        allowedSender: string,
      ) => {
        const scope = scopeFor(conversationId);
        await emailCache.authorize(scope);
        const binding = await withAccessToken(
          (token) =>
            api.createEmailIntakeBinding(token, scope.storeId, {
              conversationId,
              id,
              allowedSender,
            }),
          owner,
        );
        await emailCache.storePage(scope, {
          bindings: [binding],
          receipts: [],
          nextCursor: null,
        });
        return binding;
      },
      revokeBinding: async (conversationId: string, id: string) => {
        const scope = scopeFor(conversationId);
        await emailCache.authorize(scope);
        await withAccessToken(
          (token) =>
            api.revokeEmailIntakeBinding(
              token,
              scope.storeId,
              conversationId,
              id,
            ),
          owner,
        );
        emailCache.check(scope);
        const page = await withAccessToken(
          (token) => api.emailIntakeList(token, scope.storeId, conversationId),
          owner,
        );
        if (
          !page.bindings.some(
            (binding) => binding.id === id && !!binding.revokedAt,
          )
        )
          throw Error("EMAIL_INTAKE_BINDING_REFRESH_REQUIRED");
        await emailCache.storePage(scope, page);
      },
      decision: async (conversationId: string, receiptId: string) => {
        const scope = scopeFor(conversationId);
        const decision = await emailDecisions.get(conversationId, receiptId);
        emailCache.check(scope);
        return decision;
      },
      decide: async (
        input: Parameters<EmailDecisionRepository["decide"]>[0],
        retryOfActionId?: string,
      ) => {
        const scope = scopeFor(input.conversationId);
        const decision = await emailDecisions.decide(input, {
          actionId: randomUUID(),
          deviceId: database.deviceId,
          ...(retryOfActionId ? { retryOfActionId } : {}),
        });
        emailCache.check(scope);
        void syncNow(scope.storeId);
        return decision;
      },
      adoptDecision: async (conversationId: string, conflictId: string) => {
        const scope = scopeFor(conversationId);
        await emailDecisions.adoptRemote(conversationId, conflictId);
        emailCache.check(scope);
        void syncNow(scope.storeId);
      },
      list: async (conversationId: string) => {
        const scope = scopeFor(conversationId);
        const result = await emailCache.list(conversationId);
        emailCache.check(scope);
        return result;
      },
      refresh: async (conversationId: string, cursor?: string) => {
        const scope = scopeFor(conversationId);
        await emailCache.authorize(scope);
        const page = await withAccessToken(
          (token) =>
            api.emailIntakeList(token, scope.storeId, conversationId, cursor),
          owner,
        );
        emailCache.check(scope);
        return emailCache.storePage(scope, page);
      },
      refreshReceipt: async (ref: {
        conversationId: string;
        receiptId: string;
      }) => {
        const scope = scopeFor(ref.conversationId);
        await emailCache.authorize(scope);
        const receipt = await withAccessToken(
          (token) =>
            api.emailIntakeReceipt(token, scope.storeId, {
              conversationId: ref.conversationId,
              receiptId: ref.receiptId,
            }),
          owner,
        );
        if (receipt.id !== ref.receiptId)
          throw Error("EMAIL_INTAKE_IDENTITY_INVALID");
        await emailCache.storePage(scope, {
          bindings: [],
          receipts: [receipt],
          nextCursor: null,
        });
      },
      localOriginal: async (ref: EmailIntakeOriginalRequest) => {
        const scope = scopeFor(ref.conversationId);
        const result = await emailTransfer.local(ref);
        emailCache.check(scope);
        return result;
      },
      requestOriginal: async (
        ref: EmailIntakeOriginalRequest,
        retry = false,
      ) => {
        const scope = scopeFor(ref.conversationId);
        await emailCache.originalBasis(scope, ref);
        await originalJobs.requestEmail(ref, retry);
        emailCache.check(scope);
        void syncNow(scope.storeId);
      },
      cancelOriginal: async (ref: EmailIntakeOriginalRequest) => {
        const scope = scopeFor(ref.conversationId);
        await originalJobs.cancelEmail(ref);
        emailCache.check(scope);
      },
      processingState: async (ref: EmailIntakeOriginalRequest) => {
        const input = await processingInput(ref);
        return originalJobs.emailProcessingState(input);
      },
      retryOriginal: async (ref: EmailIntakeOriginalRequest) => {
        const scope = scopeFor(ref.conversationId);
        await queueOriginalRetry(ref);
        emailCache.check(scope);
        void syncNow(scope.storeId);
      },
      retryProcessing: async (ref: EmailIntakeOriginalRequest) => {
        const scope = scopeFor(ref.conversationId),
          input = await processingInput(ref);
        const receipt = await emailCache.receipt(
          ref.conversationId,
          ref.receiptId,
        );
        const accepted = await emailDecisions.get(
          ref.conversationId,
          ref.receiptId,
        );
        const failed =
          receipt?.files.filter(
            (file) =>
              file.status === "FAILED" &&
              accepted?.decision.files.some(
                (selection) =>
                  selection.fileId === file.id &&
                  selection.processingId === input.processingId,
              ),
          ) ?? [];
        if (failed.length) {
          for (const file of failed)
            await queueOriginalRetry({ ...ref, fileId: file.id });
        } else await originalJobs.requestEmailProcessing(input, true);
        emailCache.check(scope);
        void syncNow(scope.storeId);
      },
      setPurpose: async (
        ref: EmailIntakeOriginalRequest,
        purpose: "WASTE_TICKET" | "STORE_PHOTO",
      ) => {
        const scope = scopeFor(ref.conversationId),
          input = await processingInput(ref);
        await originalJobs.provideEmailPurpose(input, purpose);
        emailCache.check(scope);
        void syncNow(scope.storeId);
      },
      cancelProcessing: async (ref: EmailIntakeOriginalRequest) => {
        const scope = scopeFor(ref.conversationId),
          input = await processingInput(ref);
        await originalJobs.cancelEmailProcessing(input);
        emailCache.check(scope);
      },
    };
  }, [
    emailCache,
    database.sqlite,
    emailDecisions,
    database.deviceId,
    emailTransfer,
    originalJobs,
    defaultStoreId,
    session?.user.id,
    withAccessToken,
    syncNow,
  ]);
  return (
    <SyncContext.Provider
      value={{
        ...state,
        syncNow,
        originals,
        emailIntake,
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
    ownerId,
  );
  const conflictCounts = await database.getFirstAsync<{
    conflict_count: number;
  }>(
    `
        SELECT COUNT(*) AS conflict_count
        FROM sync_conflicts
        WHERE store_id = ? AND status = 'OPEN'
          AND ((entity_type NOT GLOB 'copilot_*' AND entity_type!='email_intake_decision') OR
            (json_extract(local_payload_json,'$.ownerId')=? AND
             (remote_payload_json='null' OR json_extract(remote_payload_json,'$.ownerId')=?)))
      `,
    storeId,
    ownerId ?? null,
    ownerId ?? null,
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
    pending_analytics_count: number;
    failed_count: number;
  }>(
    `
      SELECT
        SUM(CASE WHEN type='ANALYTICS_RECOMPUTE_PRODUCT_DATES' AND status='PENDING' THEN 1 ELSE 0 END) AS pending_analytics_count,
        SUM(CASE WHEN status IN ('PENDING', 'RETRY', 'RUNNING') THEN 1 ELSE 0 END)
          AS pending_count,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)
          AS failed_count
      FROM local_jobs
      WHERE json_extract(payload_json, '$.storeId') = ?
        AND (CASE WHEN type IN ('COMMERCIAL_ANALYSIS_RESUME','VISUAL_FILE_TRANSFER','SOURCE_ORIGINAL_TRANSFER','EMAIL_ORIGINAL_TRANSFER','EMAIL_ORIGINAL_RETRY','EMAIL_INTAKE_PROCESS') OR (type='SOURCE_UPLOAD_AND_REGISTER' AND EXISTS (SELECT 1 FROM source_documents d WHERE d.id=json_extract(local_jobs.payload_json,'$.sourceDocumentId') AND d.source_type='STORE_PHOTO')) THEN json_extract(payload_json,'$.ownerId')=? ELSE 1 END)
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
    pendingLocalCalculationCount: Number(
      jobCounts?.pending_analytics_count ?? 0,
    ),
    pendingCount:
      Number(outboxCounts?.pending_count ?? 0) +
      Number(jobCounts?.pending_count ?? 0),
    pendingCommandCount: Number(outboxCounts?.pending_count ?? 0),
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
