import {
  apiErrorSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  bootstrapResponseSchema,
  logoutResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type ApiErrorDto,
  type AuthChallengeRequest,
  type AuthChallengeResponse,
  type AuthSessionResponse,
  type BootstrapResponse,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
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
  ) {
    const query = new URLSearchParams();
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
  ) {
    const suffix =
      rawObservationDays === undefined
        ? ""
        : `?rawObservationDays=${encodeURIComponent(rawObservationDays)}`;
    return this.request(
      `/api/v1/sync/bootstrap${suffix}`,
      { method: "GET", headers: syncHeaders(accessToken, storeId) },
      bootstrapResponseSchema,
    ) as Promise<BootstrapResponse>;
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
    authorization: `Bearer ${accessToken}`,
    "x-store-id": storeId,
    "x-sync-protocol-version": "1",
  };
}
