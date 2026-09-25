import { z } from "zod";
/** Canonical transport error: DATABASE_AND_API_CONTRACTS §128. */
export const apiErrorSchema = z.object({
  code: z.string().min(1),
  messageFr: z.string().min(1),
  retryable: z.boolean(),
  details: z.unknown().optional(),
  requestId: z.string().min(1).optional(),
});
export type ApiErrorDto = z.infer<typeof apiErrorSchema>;
/** API and database readiness, introduced in M0-T05. */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("fl-copilot-api"),
  database: z.object({
    status: z.enum(["connected", "disconnected"]),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const platformSchema = z.enum(["IOS", "ANDROID"]);

export const authChallengeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  deviceId: z.string().uuid(),
  platform: platformSchema,
  appVersion: z.string().trim().min(1).max(40),
});
export type AuthChallengeRequest = z.infer<typeof authChallengeRequestSchema>;

export const authChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});
export type AuthChallengeResponse = z.infer<typeof authChallengeResponseSchema>;

export const authVerificationRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
});

export const storeAccessSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().min(1),
});

export const authSessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(32),
  user: authUserSchema,
  stores: z.array(storeAccessSchema),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const refreshSessionRequestSchema = z.object({
  deviceId: z.string().uuid(),
  refreshToken: z.string().min(32),
});

export const logoutResponseSchema = z.object({ revoked: z.literal(true) });
