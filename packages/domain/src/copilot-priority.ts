import { z } from "zod";
import { eligibleCopilotCandidateSchema } from "./copilot-eligibility";
const level = z.number().finite().min(0).max(1);
export const copilotPriorityPolicySchema = z
  .object({
    version: z.literal("copilot-priority.v1"),
    weights: z
      .object({
        urgency: level,
        economicImpact: level,
        deviation: level,
        dataQuality: level,
      })
      .strict(),
    deadlineBoosts: z
      .object({
        within24Hours: level,
        within48Hours: level,
        within7Days: level,
      })
      .strict(),
  })
  .strict()
  .refine(
    (p) =>
      Math.abs(Object.values(p.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9,
    "Weights must sum to one",
  )
  .refine(
    (p) =>
      p.deadlineBoosts.within24Hours >= p.deadlineBoosts.within48Hours &&
      p.deadlineBoosts.within48Hours >= p.deadlineBoosts.within7Days,
    "Deadline boosts must decrease with time",
  );
export const copilotPriorityComponentSchema = z
  .object({
    value: level.nullable(),
    weight: level,
    contribution: level.nullable(),
  })
  .strict();
export const scoredCopilotCandidateSchema = eligibleCopilotCandidateSchema
  .extend({
    priority: z
      .object({
        score: level.nullable(),
        baseScore: level.nullable(),
        components: z
          .object({
            urgency: copilotPriorityComponentSchema,
            economicImpact: copilotPriorityComponentSchema,
            deviation: copilotPriorityComponentSchema,
            dataQuality: copilotPriorityComponentSchema,
          })
          .strict(),
        deadline: z
          .object({
            remainingHours: z.number().finite().nonnegative().nullable(),
            boost: level.nullable(),
            band: z.enum([
              "WITHIN_24_HOURS",
              "WITHIN_48_HOURS",
              "WITHIN_7_DAYS",
              "LATER",
              "UNKNOWN",
              "NOT_SCORED",
            ]),
          })
          .strict(),
        missingDimensions: z.array(
          z.enum(["urgency", "economicImpact", "deviation", "dataQuality"]),
        ),
        basis: z.literal("KNOWN_CONTRIBUTIONS_ONLY"),
      })
      .strict(),
  })
  .strict();
export const copilotPriorityBatchSchema = z
  .object({
    ruleVersion: z.literal("copilot-priority.v1"),
    storeId: z.string().uuid(),
    evaluatedAt: z.string().datetime(),
    policy: copilotPriorityPolicySchema,
    candidates: z.array(scoredCopilotCandidateSchema),
  })
  .strict();
export type CopilotPriorityPolicy = z.infer<typeof copilotPriorityPolicySchema>;
export type CopilotPriorityBatch = z.infer<typeof copilotPriorityBatchSchema>;
