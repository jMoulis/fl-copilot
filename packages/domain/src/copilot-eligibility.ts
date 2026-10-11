import { z } from "zod";
import { copilotCandidateSchema } from "./copilot-candidate";
const ref = z.string().min(1).max(1000);
export const copilotEligibilityPolicySchema = z
  .object({
    version: z.literal("copilot-eligibility.v1"),
    minimumDataQuality: z.number().finite().min(0).max(1),
  })
  .strict();
export const copilotEntitySnapshotSchema = z
  .object({
    id: ref,
    storeId: z.string().uuid(),
    kind: z.enum(["PRODUCT", "OPERATION", "NEED", "RELATION", "OTHER"]),
    state: z.enum([
      "ACTIVE",
      "INACTIVE",
      "MISSING",
      "APPLICABLE",
      "NOT_APPLICABLE",
      "UNKNOWN",
      "VALIDATED",
      "LEARNING",
      "REJECTED",
      "PROPOSED",
    ]),
    syncState: z.enum(["SYNCED", "PENDING", "CONFLICT", "ERROR"]),
    version: z.number().int().positive(),
    humanConfirmed: z.boolean().nullable(),
  })
  .strict();
/** Resolved from canonical state by a trusted adapter, never from model output. */
export const copilotCandidateFactsSchema = z
  .object({
    candidateId: ref,
    storeId: z.string().uuid(),
    sourceCurrent: z.boolean().nullable(),
    criticalAmbiguity: z.boolean(),
    missingCriticalFacts: z.array(z.string().min(1).max(240)),
    purchaseCostKnown: z.boolean().nullable(),
    executionRequired: z.boolean(),
    executionComplete: z.boolean().nullable(),
  })
  .strict();
export const copilotEligibilityReasonSchema = z
  .object({
    code: z.enum([
      "ENTITY_UNVERIFIED",
      "INVALID_ENTITY",
      "ENTITY_UNRESOLVED",
      "RELATION_REJECTED",
      "RELATION_UNCONFIRMED",
      "OPERATION_NOT_APPLICABLE",
      "OPERATION_UNVERIFIED",
      "OBSOLETE_DEADLINE",
      "INSUFFICIENT_QUALITY",
      "UNKNOWN_QUALITY",
      "MISSING_REQUIRED_COST",
      "CRITICAL_AMBIGUITY",
      "MISSING_CRITICAL_FACT",
      "INCOMPLETE_EXECUTION",
      "STALE_SOURCE",
      "SOURCE_UNVERIFIED",
      "FACTS_UNVERIFIED",
    ]),
    severity: z.enum(["REVIEW", "SUPPRESS"]),
    referenceId: ref.nullable(),
  })
  .strict();
export const eligibleCopilotCandidateSchema = copilotCandidateSchema
  .extend({
    status: z.enum(["ELIGIBLE", "TO_REVIEW", "SUPPRESSED"]),
    eligibility: z
      .object({
        ruleVersion: z.literal("copilot-eligibility.v1"),
        evaluatedAt: z.string().datetime(),
        policy: copilotEligibilityPolicySchema,
        reasons: z.array(copilotEligibilityReasonSchema),
      })
      .strict(),
  })
  .strict();
export type CopilotEntitySnapshot = z.infer<typeof copilotEntitySnapshotSchema>;
export type CopilotCandidateFacts = z.infer<typeof copilotCandidateFactsSchema>;
export type EligibleCopilotCandidate = z.infer<
  typeof eligibleCopilotCandidateSchema
>;
