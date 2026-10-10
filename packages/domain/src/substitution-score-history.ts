import { z } from "zod";
export const substitutionScorePolicySchema = z
  .object({
    version: z.literal("substitution-score.v1"),
    needWeight: z.number().finite().positive().max(1),
    usageWeight: z.number().finite().positive().max(1),
    priceWeight: z.number().finite().nonnegative().max(1),
    packagingWeight: z.number().finite().nonnegative().max(1),
    observedWeight: z.number().finite().positive().max(1),
    maxEvidenceStep: z.number().finite().positive().max(0.05),
    confidenceCeiling: z.number().finite().positive().max(0.5),
  })
  .strict()
  .refine(
    (p) =>
      Math.abs(
        p.needWeight +
          p.usageWeight +
          p.priceWeight +
          p.packagingWeight +
          p.observedWeight -
          1,
      ) < 1e-9,
    "Les poids doivent totaliser 1.",
  );
export type SubstitutionScorePolicy = z.infer<
  typeof substitutionScorePolicySchema
>;

const level = z.number().finite().min(0).max(1).nullable();
export const substitutionScoreMetricsSchema = z
  .object({
    observedSubstitution: level,
    relationshipScore: level,
    confidence: level,
    evidenceCount: z.number().int().nonnegative(),
    lastEvidenceAt: z.string().datetime().nullable(),
  })
  .strict()
  .refine(
    (m) =>
      m.evidenceCount > 0 ||
      (m.observedSubstitution === null &&
        m.relationshipScore === null &&
        m.confidence === null &&
        m.lastEvidenceAt === null),
    "Un score observé nécessite des indices.",
  );
export const substitutionScoreHistorySchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    substitutionId: z.string().uuid(),
    sourceProductId: z.string().uuid(),
    substituteProductId: z.string().uuid(),
    needUnitId: z.string().uuid(),
    version: z.literal(1),
    relationshipVersion: z.number().int().positive(),
    inputRevision: z.string().regex(/^[a-f0-9]{64}$/),
    previous: substitutionScoreMetricsSchema,
    next: substitutionScoreMetricsSchema,
    reason: z.enum([
      "INITIAL",
      "NEW_EVIDENCE",
      "CONFIGURATION_CHANGE",
      "USER_VALIDATION",
    ]),
    policy: substitutionScorePolicySchema,
    compatibility: z
      .object({
        need: z.number().min(0).max(1),
        usage: z.number().min(0).max(1),
        price: level,
        packaging: level,
      })
      .strict(),
    evidence: z
      .array(
        z
          .object({
            evidenceId: z.string().uuid(),
            eventId: z.string().uuid(),
            version: z.number().int().positive(),
            inputRevision: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.enum([
              "USED",
              "NOT_READY",
              "NEUTRAL",
              "DEPENDENT",
              "NO_INFORMATION",
            ]),
            interpretation: z
              .enum([
                "SUPPORTS_SUBSTITUTION",
                "NEUTRAL",
                "CONTRADICTS_SUBSTITUTION",
              ])
              .nullable(),
            quality: level,
            strength: z.number().min(0).max(0.5).nullable(),
            eventEndedAt: z.string().datetime().nullable(),
            actualSalesValue: z
              .string()
              .regex(/^-?\d+(?:\.\d+)?$/)
              .nullable(),
            expectedSalesValue: z
              .string()
              .regex(/^-?\d+(?:\.\d+)?$/)
              .nullable(),
            observedVariationPct: z
              .string()
              .regex(/^-?\d+(?:\.\d+)?$/)
              .nullable(),
          })
          .strict(),
      )
      .max(1000),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (h) =>
      new Set(h.evidence.map((e) => e.evidenceId)).size === h.evidence.length &&
      h.next.evidenceCount ===
        h.evidence.filter((e) => e.reason === "USED").length,
    "Les indices et leur compteur doivent correspondre.",
  );
export type SubstitutionScoreHistory = z.infer<
  typeof substitutionScoreHistorySchema
>;
