import { z } from "zod";
import { copilotExternalResearchSourceSchema } from "./copilot-web-research";
const score = z.number().finite().min(0).max(1);
const ref = z.string().min(1).max(1000);
export const recommendationTypeSchema = z.enum([
  "CHECK_STOCK",
  "CHECK_QUALITY",
  "CHECK_PRICE",
  "CHECK_PLU",
  "CHECK_STORELINE",
  "ACTIVATE_DRIVE",
  "PLACE_PREORDER_REMINDER",
  "INSTALL_TG",
  "ADJUST_MERCHANDISING",
  "REINFORCE_SUBSTITUTE",
  "MONITOR_SUBSTITUTE",
  "AVOID_PROMOTION_OVERLAP",
  "CONSIDER_LOCAL_PROMOTION",
  "CONSIDER_LOT_SALE",
  "REDUCE_WASTE_EXPOSURE",
  "MONITOR_HIGH_WASTE",
  "INVESTIGATE_SALES_DROP",
  "INVESTIGATE_MARGIN_DROP",
  "VALIDATE_DATA",
  "WAIT_FOR_MORE_DATA",
  "OTHER",
]);
export const copilotEvidenceSchema = z
  .object({
    id: ref,
    sourceType: z.enum([
      "KPI",
      "COMPARISON",
      "EVENT",
      "COMMERCIAL_OPERATION",
      "SUBSTITUTION",
      "DATA_QUALITY",
      "SOURCE_DOCUMENT",
    ]),
    sourceId: ref,
    sourceVersion: z.number().int().positive().nullable(),
    label: z.string().min(1).max(1000),
    value: z.union([z.string().max(10000), z.number().finite(), z.null()]),
    detail: z.string().max(10000).optional(),
    externalResearch: copilotExternalResearchSourceSchema.optional(),
    factKind: z.enum([
      "OBSERVED",
      "SOURCE_INSTRUCTION",
      "PLANNED",
      "DERIVED",
      "QUALITY",
    ]),
  })
  .strict()
  .refine(
    (e) =>
      !e.externalResearch ||
      (e.sourceType === "SOURCE_DOCUMENT" &&
        e.factKind === "SOURCE_INSTRUCTION" &&
        e.sourceVersion === null &&
        e.id.startsWith("public-web-research/")),
  );
export const candidateContextSchema = z
  .object({
    productIds: z.array(ref),
    operationIds: z.array(ref),
    needUnitIds: z.array(ref),
    relationshipIds: z.array(ref),
    sourceLineageIds: z.array(ref),
    planRevisionId: ref.nullable(),
    missingData: z.array(z.string().min(1).max(240)),
    availability: z.enum(["UNKNOWN", "RECORDED_STOCKOUT"]),
  })
  .strict();
const base = {
  storeId: z.string().uuid(),
  type: recommendationTypeSchema,
  entityIds: z.array(ref).min(1),
  urgencyScore: score.nullable(),
  economicImpactScore: score.nullable(),
  deviationScore: score.nullable(),
  dataQualityScore: score.nullable(),
  relationshipScore: score.nullable(),
  relationshipConfidence: score.nullable(),
  deadlineAt: z.string().datetime().nullable(),
  evidence: z.array(copilotEvidenceSchema),
  context: candidateContextSchema,
  warnings: z.array(z.string().min(1).max(240)),
};
/** Trusted deterministic producer input, never model-authored facts. */
export const weeklyCopilotCandidateSchema = z
  .object({
    ...base,
    id: ref,
    weekStart: z.string().date(),
    sourceType: z.enum([
      "DEADLINE",
      "EXECUTION_RISK",
      "MARKET_TENSION",
      "SUBSTITUTION_OPPORTUNITY",
      "PROMOTION_OVERLAP",
      "WASTE_OPPORTUNITY",
      "MERCHANDISING_OPPORTUNITY",
      "DATA_QUALITY_ALERT",
    ]),
  })
  .strict();
export const copilotCandidateSchema = z
  .object({
    ...base,
    id: ref,
    sourceCandidateIds: z.array(ref).min(1),
    origin: z.enum(["ANALYTICAL", "WEEKLY_COMMERCIAL"]),
    sourceType: ref,
    scope: z.enum(["DAILY", "WEEKLY", "PRODUCT", "OPERATION", "ACTION_REVIEW"]),
    businessDate: z.string().date().nullable(),
    weekStart: z.string().date().nullable(),
    evidenceIds: z.array(ref),
    status: z.literal("TO_REVIEW"),
  })
  .strict();
export type CopilotCandidate = z.infer<typeof copilotCandidateSchema>;
export type WeeklyCopilotCandidate = z.infer<
  typeof weeklyCopilotCandidateSchema
>;
export type CandidateContext = z.infer<typeof candidateContextSchema>;
