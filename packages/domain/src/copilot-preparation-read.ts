import { z } from "zod";
import { copilotPlanReadInputSchema } from "./copilot-commercial-plan-read";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { copilotEvidenceSchema } from "./copilot-candidate";
/** Explicit week; bounded selected-offer detail, never mutation authority. */
export const copilotPreparationReadInputSchema = copilotPlanReadInputSchema;
export const copilotPreparationReadResultSchema = z.strictObject({
  weekStart: copilotPreparationReadInputSchema.shape.weekStart,
  status: z.enum(["DRAFT", "NO_DRAFT"]),
  preparation: commercialWeekPreparationSchema.nullable(),
  choices: z.array(commercialOfferChoiceSchema).max(20),
  issues: z
    .array(
      z.strictObject({
        choiceId: z.uuid(),
        code: z.enum(["MISSING", "WITHDRAWN", "CHANGED", "OUTSIDE_WEEK"]),
      }),
    )
    .max(100),
  missingChoiceIds: z.array(z.uuid()).max(20),
  nextOffset: z.number().int().nonnegative().nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(52),
});
export function validatePreparationReadResult(
  storeId: string,
  input: z.infer<typeof copilotPreparationReadInputSchema>,
  raw: unknown,
) {
  const result = copilotPreparationReadResultSchema.parse(raw),
    p = result.preparation;
  const refs = p?.offerRefs ?? [];
  const page = refs
    .slice(input.offset, input.offset + input.limit)
    .map((r) => r.choiceId);
  const covered = [
    ...result.choices.map((c) => c.id),
    ...result.missingChoiceIds,
  ];
  const expectedNext =
    input.offset + page.length < refs.length
      ? input.offset + page.length
      : null;
  if (
    result.weekStart !== input.weekStart ||
    (p && (p.storeId !== storeId || p.weekStart !== input.weekStart)) ||
    result.status !== (p ? "DRAFT" : "NO_DRAFT") ||
    result.choices.some((c) => c.storeId !== storeId) ||
    covered.length !== page.length ||
    new Set(covered).size !== covered.length ||
    covered.some((id) => !page.includes(id)) ||
    result.issues.some((i) => !refs.some((r) => r.choiceId === i.choiceId)) ||
    new Set(result.issues.map((i) => i.choiceId)).size !==
      result.issues.length ||
    result.nextOffset !== expectedNext
  )
    throw Error("COPILOT_PREPARATION_SCOPE_INVALID");
  return result;
}
