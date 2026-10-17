import { z } from "zod";
import { contextWeekQuerySchema } from "./weekly-context";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotPlanReadinessInputSchema = z.strictObject({
  weekStart: contextWeekQuerySchema.shape.weekStart,
});
export const copilotPlanReadinessResultSchema = z
  .strictObject({
    storeId: z.uuid(),
    weekStart: contextWeekQuerySchema.shape.weekStart,
    status: z.enum(["READY", "BLOCKED", "NO_DRAFT", "LIMIT_EXCEEDED"]),
    preparation: z
      .strictObject({
        id: z.uuid(),
        version: z.number().int().positive(),
        selectedOfferCount: z.number().int().nonnegative(),
        placementCount: z.number().int().nonnegative(),
        tgCapacity: z.number().int().nonnegative().nullable(),
      })
      .nullable(),
    issues: z
      .array(
        z.strictObject({
          code: z.string().min(1).max(100),
          messageFr: z.string().min(1).max(1000),
          choiceId: z.uuid().optional(),
          placementId: z.uuid().optional(),
          label: z.string().max(300).nullable(),
        }),
      )
      .max(200),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((r) => {
    if (r.status === "NO_DRAFT")
      return r.preparation === null && !r.issues.length;
    if (!r.preparation) return false;
    return r.status === "BLOCKED" ? r.issues.length > 0 : !r.issues.length;
  });
export function validatePlanReadinessResult(
  storeId: string,
  input: z.infer<typeof copilotPlanReadinessInputSchema>,
  raw: unknown,
) {
  const result = copilotPlanReadinessResultSchema.parse(raw);
  if (result.storeId !== storeId || result.weekStart !== input.weekStart)
    throw Error("COPILOT_PLAN_READINESS_SCOPE");
  return result;
}
