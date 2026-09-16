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
