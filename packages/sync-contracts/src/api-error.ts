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
