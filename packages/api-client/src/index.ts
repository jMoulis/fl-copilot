import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { readCopilotStream } from "./copilot-stream";
import {
  copilotTurnRequestSchema,
  copilotTurnResultSchema,
  type CopilotTurnRequest,
} from "@fl-copilot/sync-contracts";
import {
  copilotHistoryPageSchema,
  type CopilotHistoryPage,
} from "@fl-copilot/sync-contracts";
import {
  weeklyContextSchema,
  type WeeklyContext,
} from "@fl-copilot/sync-contracts";
import {
  commercialOriginalLinkSchema,
  type CommercialOriginalLink,
} from "@fl-copilot/sync-contracts";
import {
  apiErrorSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  bootstrapResponseSchema,
  completeSourceUploadResponseSchema,
  initSourceUploadResponseSchema,
  importVerificationResultSchema,
  logoutResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type ApiErrorDto,
  type AuthChallengeRequest,
  type AuthChallengeResponse,
  type AuthSessionResponse,
  type BootstrapResponse,
  type CompleteSourceUploadRequest,
  type CompleteSourceUploadResponse,
  type InitSourceUploadRequest,
  type InitSourceUploadResponse,
  type ImportVerificationResult,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type VerifyImportRequest,
} from "@fl-copilot/sync-contracts";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly response: ApiErrorDto,
  ) {
    super(response.messageFr);
  }
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async copilotTurn(
    accessToken: string,
    storeId: string,
    ownerId: string,
    raw: CopilotTurnRequest,
    signal?: AbortSignal,
    streaming?: {
      onProgress(text: string): void;
      onActivity?(activity: CopilotActivity): void;
      memorySuggestions?: boolean;
      webResearch?: boolean;
      catalogueProposals?: boolean;
      executionProposals?: boolean;
      fetch?: typeof fetch;
    },
  ) {
    const input = copilotTurnRequestSchema.parse(raw);
    const streamResult = streaming
      ? await (async () => {
          const response = await (streaming.fetch ?? fetch)(
            `${this.baseUrl}/api/v1/copilot/turn`,
            {
              method: "POST",
              signal,
              headers: {
                ...authorizedStoreHeaders(accessToken, storeId),
                "content-type": "application/json",
                accept: "application/x-ndjson",
                ...(streaming.onActivity ? { "x-copilot-activity": "1" } : {}),
                ...(streaming.catalogueProposals
                  ? { "x-copilot-catalogue-proposals": "1" }
                  : {}),
                ...(streaming.executionProposals
                  ? { "x-copilot-execution-proposals": "1" }
                  : {}),
                ...(streaming.webResearch
                  ? { "x-copilot-web-research": "1" }
                  : {}),
                ...(streaming.memorySuggestions
                  ? { "x-copilot-memory-suggestions": "1" }
                  : {}),
              },
              body: JSON.stringify(input),
            },
          );
          if (!response.ok) {
            const error = apiErrorSchema.safeParse(
              await response.json().catch(() => undefined),
            );
            throw new ApiClientError(
              response.status,
              error.success
                ? error.data
                : {
                    code: "COPILOT_UNAVAILABLE",
                    messageFr: "La réponse s’est interrompue. Réessayez.",
                    retryable: true,
                  },
            );
          }
          return copilotTurnResultSchema.parse(
            response.headers
              .get("content-type")
              ?.includes("application/x-ndjson")
              ? await readCopilotStream(
                  response,
                  input,
                  streaming.onProgress,
                  signal,
                  streaming.onActivity,
                )
              : await response.json(),
          );
        })()
      : undefined;
    const result =
      streamResult ??
      (await this.request(
        "/api/v1/copilot/turn",
        {
          signal,
          method: "POST",
          headers: authorizedStoreHeaders(accessToken, storeId),
          body: JSON.stringify(input),
        },
        copilotTurnResultSchema,
      ));
    const message = result.message;
    if (
      message.id !== input.replyId ||
      message.storeId !== storeId ||
      message.ownerId !== ownerId ||
      message.conversationId !== input.conversationId ||
      message.replyToMessageId !== input.userMessageId ||
      message.role !== "ASSISTANT"
    )
      throw new ApiClientError(200, {
        code: "COPILOT_REPLY_SCOPE_INVALID",
        messageFr:
          "La réponse du copilote ne correspond pas à cette conversation.",
        retryable: false,
      });
    return result;
  }
  weeklyContext(accessToken: string, storeId: string, weekStart: string) {
    return this.request(
      `/api/v1/store/context?${new URLSearchParams({ weekStart })}`,
      { method: "GET", headers: syncHeaders(accessToken, storeId) },
      weeklyContextSchema,
    ) as Promise<WeeklyContext>;
  }
  requestLoginCode(input: AuthChallengeRequest) {
    return this.request(
      "/api/v1/auth/challenges",
      { method: "POST", body: JSON.stringify(input) },
      authChallengeResponseSchema,
    ) as Promise<AuthChallengeResponse>;
  }

  verifyLoginCode(challengeId: string, code: string) {
    return this.request(
      `/api/v1/auth/challenges/${encodeURIComponent(challengeId)}/verify`,
      { method: "POST", body: JSON.stringify({ code }) },
      authSessionResponseSchema,
    ) as Promise<AuthSessionResponse>;
  }

  refreshSession(deviceId: string, refreshToken: string) {
    return this.request(
      "/api/v1/auth/refresh",
      { method: "POST", body: JSON.stringify({ deviceId, refreshToken }) },
      authSessionResponseSchema,
    ) as Promise<AuthSessionResponse>;
  }

  async logout(accessToken: string) {
    await this.request(
      "/api/v1/auth/logout",
      { method: "POST", headers: { authorization: `Bearer ${accessToken}` } },
      logoutResponseSchema,
    );
  }

  pushSync(accessToken: string, input: SyncPushRequest) {
    return this.request(
      "/api/v1/sync/push",
      {
        method: "POST",
        headers: syncHeaders(accessToken, input.storeId),
        body: JSON.stringify(input),
      },
      syncPushResponseSchema,
    ) as Promise<SyncPushResponse>;
  }

  pullSync(
    accessToken: string,
    storeId: string,
    cursor?: string,
    limit?: number,
    commercialReview = false,
    commercialVisual = false,
    commercialChoices = false,
    commercialPreparation = false,
    commercialVersions = false,
    commercialValidation = false,
    commercialPlans = false,
    commercialExecution = false,
    storeContext = false,
    needUnits = false,
    needMemberships = false,
    productSubstitutions = false,
    storeProductEvents = false,
    substitutionEvidence = false,
    substitutionScores = false,
    copilotHistory = false,
    mercalysPublications = false,
    copilotKnowledge = false,
  ) {
    const query = new URLSearchParams();
    if (commercialReview) query.set("commercialReview", "true");
    if (commercialVisual) query.set("commercialVisual", "true");
    if (commercialChoices) query.set("commercialChoices", "true");
    if (commercialPreparation) query.set("commercialPreparation", "true");
    if (commercialVersions) query.set("commercialVersions", "true");
    if (commercialValidation) query.set("commercialValidation", "true");
    if (commercialPlans) query.set("commercialPlans", "true");
    if (commercialExecution) query.set("commercialExecution", "true");
    if (storeContext) query.set("storeContext", "true");
    if (needUnits) query.set("needUnits", "true");
    if (needMemberships) query.set("needMemberships", "true");
    if (productSubstitutions) query.set("productSubstitutions", "true");
    if (storeProductEvents) query.set("storeProductEvents", "true");
    if (substitutionEvidence) query.set("substitutionEvidence", "true");
    if (substitutionScores) query.set("substitutionScores", "true");
    if (copilotHistory) query.set("copilotHistory", "true");
    if (copilotKnowledge) query.set("copilotKnowledge", "true");
    if (mercalysPublications) query.set("mercalysPublications", "true");
    if (cursor) query.set("cursor", cursor);
    if (limit !== undefined) query.set("limit", String(limit));
    const encodedQuery = query.toString();
    const suffix = encodedQuery ? `?${encodedQuery}` : "";
    return this.request(
      `/api/v1/sync/pull${suffix}`,
      { method: "GET", headers: syncHeaders(accessToken, storeId) },
      syncPullResponseSchema,
    ) as Promise<SyncPullResponse>;
  }

  bootstrapSync(
    accessToken: string,
    storeId: string,
    rawObservationDays?: number,
    commercialReview = false,
    commercialVisual = false,
    commercialChoices = false,
    commercialPreparation = false,
    commercialVersions = false,
    commercialValidation = false,
    commercialPlans = false,
    commercialExecution = false,
    storeContext = false,
    needUnits = false,
    needMemberships = false,
    productSubstitutions = false,
    storeProductEvents = false,
    substitutionEvidence = false,
    substitutionScores = false,
    copilotHistory = false,
    mercalysPublications = false,
    copilotKnowledge = false,
  ) {
    const query = new URLSearchParams();
    if (rawObservationDays !== undefined)
      query.set("rawObservationDays", String(rawObservationDays));
    if (commercialReview) query.set("commercialReview", "true");
    if (commercialVisual) query.set("commercialVisual", "true");
    if (commercialChoices) query.set("commercialChoices", "true");
    if (commercialPreparation) query.set("commercialPreparation", "true");
    if (commercialVersions) query.set("commercialVersions", "true");
    if (commercialValidation) query.set("commercialValidation", "true");
    if (commercialPlans) query.set("commercialPlans", "true");
    if (commercialExecution) query.set("commercialExecution", "true");
    if (storeContext) query.set("storeContext", "true");
    if (needUnits) query.set("needUnits", "true");
    if (needMemberships) query.set("needMemberships", "true");
    if (productSubstitutions) query.set("productSubstitutions", "true");
    if (storeProductEvents) query.set("storeProductEvents", "true");
    if (substitutionEvidence) query.set("substitutionEvidence", "true");
    if (substitutionScores) query.set("substitutionScores", "true");
    if (copilotHistory) query.set("copilotHistory", "true");
    if (copilotKnowledge) query.set("copilotKnowledge", "true");
    if (mercalysPublications) query.set("mercalysPublications", "true");
    const suffix = query.toString() ? `?${query}` : "";
    return this.request(
      `/api/v1/sync/bootstrap${suffix}`,
      { method: "GET", headers: syncHeaders(accessToken, storeId) },
      bootstrapResponseSchema,
    ) as Promise<BootstrapResponse>;
  }

  copilotHistory(
    accessToken: string,
    storeId: string,
    conversationId?: string,
    before?: { createdAt: string; id: string },
    limit = 50,
  ): Promise<CopilotHistoryPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (conversationId) query.set("conversationId", conversationId);
    if (before) {
      query.set("beforeCreatedAt", before.createdAt);
      query.set("beforeId", before.id);
    }
    return this.request(
      `/api/v1/copilot/history?${query}`,
      { method: "GET", headers: authorizedStoreHeaders(accessToken, storeId) },
      copilotHistoryPageSchema,
    ) as Promise<CopilotHistoryPage>;
  }
  commercialOriginalLink(
    accessToken: string,
    storeId: string,
    sourceDocumentId: string,
  ) {
    return this.request(
      `/api/v1/commercial/${encodeURIComponent(sourceDocumentId)}/original-link`,
      { method: "GET", headers: authorizedStoreHeaders(accessToken, storeId) },
      commercialOriginalLinkSchema,
    ) as Promise<CommercialOriginalLink>;
  }
  initSourceUpload(
    accessToken: string,
    storeId: string,
    input: InitSourceUploadRequest,
  ) {
    return this.request(
      "/api/v1/uploads/init",
      {
        method: "POST",
        headers: authorizedStoreHeaders(accessToken, storeId),
        body: JSON.stringify(input),
      },
      initSourceUploadResponseSchema,
    ) as Promise<InitSourceUploadResponse>;
  }

  completeSourceUpload(
    accessToken: string,
    storeId: string,
    uploadId: string,
    input: CompleteSourceUploadRequest,
  ) {
    return this.request(
      `/api/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      {
        method: "POST",
        headers: authorizedStoreHeaders(accessToken, storeId),
        body: JSON.stringify(input),
      },
      completeSourceUploadResponseSchema,
    ) as Promise<CompleteSourceUploadResponse>;
  }

  verifyImport(
    accessToken: string,
    storeId: string,
    sourceDocumentId: string,
    input: VerifyImportRequest,
  ) {
    return this.request(
      `/api/v1/imports/${encodeURIComponent(sourceDocumentId)}/verify`,
      {
        method: "POST",
        headers: authorizedStoreHeaders(accessToken, storeId),
        body: JSON.stringify(input),
      },
      importVerificationResultSchema,
    ) as Promise<ImportVerificationResult>;
  }

  private async request<T extends z.ZodType>(
    path: string,
    init: RequestInit,
    schema: T,
  ): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiClientError(0, {
        code: "NETWORK_UNAVAILABLE",
        messageFr: "Connexion au service impossible. Vérifiez votre réseau.",
        retryable: true,
      });
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = apiErrorSchema.safeParse(payload);
      throw new ApiClientError(
        response.status,
        error.success
          ? error.data
          : {
              code: "INVALID_API_RESPONSE",
              messageFr: "Le service a renvoyé une réponse inattendue.",
              retryable: response.status >= 500,
            },
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError(response.status, {
        code: "INVALID_API_RESPONSE",
        messageFr: "Le service a renvoyé une réponse inattendue.",
        retryable: false,
      });
    }
    return parsed.data;
  }
}

function syncHeaders(accessToken: string, storeId: string) {
  return {
    ...authorizedStoreHeaders(accessToken, storeId),
    "x-sync-protocol-version": "1",
  };
}

function authorizedStoreHeaders(accessToken: string, storeId: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    "x-store-id": storeId,
  };
}
