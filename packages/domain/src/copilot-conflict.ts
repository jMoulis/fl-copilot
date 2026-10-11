import { z } from "zod";
import { copilotPriorityBatchSchema } from "./copilot-priority";
const ref = z.string().min(1).max(1000),
  time = z.string().datetime();
/** Deterministic producer intent, not an executed action or free-form model assertion. */
export const copilotActionIntentSchema = z
  .object({
    id: ref,
    storeId: z.string().uuid(),
    candidateId: ref,
    productId: ref,
    axis: z.enum(["DISPLAY", "PROMOTION"]),
    direction: z.enum(["INCREASE", "MAINTAIN", "REDUCE", "ACTIVATE", "AVOID"]),
    startsAt: time.nullable(),
    endsAt: time.nullable(),
  })
  .strict()
  .refine(
    (s) =>
      s.axis === "DISPLAY"
        ? ["INCREASE", "MAINTAIN", "REDUCE"].includes(s.direction)
        : ["ACTIVATE", "AVOID"].includes(s.direction),
    "Invalid action axis/direction",
  )
  .refine(
    (s) =>
      !s.startsAt ||
      !s.endsAt ||
      Date.parse(s.startsAt) <= Date.parse(s.endsAt),
    "Invalid action period",
  );
export const copilotTradeOffSchema = z
  .object({
    id: z.string().min(1).max(5000),
    productId: ref,
    axis: z.enum(["DISPLAY", "PROMOTION"]),
    candidateIds: z.tuple([ref, ref]),
    sourceCandidateIds: z.array(ref),
    evidenceIds: z.array(ref),
    options: z.array(copilotActionIntentSchema).min(2),
    certainty: z.enum([
      "OVERLAPPING_PERIODS",
      "MULTIPLE_OVERLAPPING_PERIODS",
      "POSSIBLE_UNKNOWN_PERIOD",
    ]),
    overlapStartsAt: time.nullable(),
    overlapEndsAt: time.nullable(),
    resolution: z.literal("HUMAN_TRADE_OFF_REQUIRED"),
  })
  .strict();
export const copilotConflictReportSchema = z
  .object({
    ruleVersion: z.literal("copilot-conflicts.v1"),
    batch: copilotPriorityBatchSchema,
    intents: z.array(copilotActionIntentSchema),
    tradeOffs: z.array(copilotTradeOffSchema),
    ignoredIntents: z.array(
      z
        .object({
          id: ref,
          reason: z.enum(["CANDIDATE_NOT_ELIGIBLE", "PAST_ACTION_WINDOW"]),
        })
        .strict(),
    ),
    independentCandidateIds: z.array(ref),
    candidatesWithoutIntent: z.array(ref),
  })
  .strict();
export type CopilotActionIntent = z.infer<typeof copilotActionIntentSchema>;
export type CopilotTradeOff = z.infer<typeof copilotTradeOffSchema>;
