import {
  apiErrorSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  logoutResponseSchema,
  type ApiErrorDto,
  type AuthChallengeRequest,
  type AuthChallengeResponse,
  type AuthSessionResponse,
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
