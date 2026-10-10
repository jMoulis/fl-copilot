import { z } from "zod";
import {
  productSubstitutionSchema,
  substitutionEvidenceSchema,
  type ProductSubstitution,
  type SubstitutionEvidence,
} from "@fl-copilot/domain";

// Versioned policy, not a statistical probability or a causal attribution.
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
export const conservativeSubstitutionScorePolicy: SubstitutionScorePolicy = {
  version: "substitution-score.v1",
  needWeight: 0.3,
  usageWeight: 0.3,
  priceWeight: 0.1,
  packagingWeight: 0.1,
  observedWeight: 0.2,
  maxEvidenceStep: 0.05,
  confidenceCeiling: 0.5,
};
const rounded = (n: number) => Math.round(n * 1e8) / 1e8;
export type ScoreEvidenceDecision = {
  evidenceId: string;
  version: number;
  inputRevision: string;
  reason: "USED" | "NOT_READY" | "NEUTRAL" | "DEPENDENT" | "NO_INFORMATION";
};

/** Replay current evidence revisions; never compound the previously learned score.
 * Caller must supply the complete canonical evidence set, including invalidated
 * revisions. Persistence and atomic audit are deliberately owned by M6-T08.
 */
export function calculateConservativeSubstitutionScore(input: {
  relation: ProductSubstitution;
  evidence: SubstitutionEvidence[];
  policy?: SubstitutionScorePolicy;
}) {
  const relation = productSubstitutionSchema.parse(input.relation);
  const policy = substitutionScorePolicySchema.parse(
    input.policy ?? conservativeSubstitutionScorePolicy,
  );
  if (
    relation.status === "REJECTED" ||
    !relation.humanConfirmed ||
    relation.status === "PROPOSED"
  )
    return {
      status: "INELIGIBLE" as const,
      policyVersion: policy.version,
      metrics: null,
      decisions: [] as ScoreEvidenceDecision[],
    };
  const latest = new Map<string, SubstitutionEvidence>();
  for (const raw of input.evidence) {
    const e = substitutionEvidenceSchema.parse(raw);
    if (
      e.storeId !== relation.storeId ||
      e.relationshipId !== relation.id ||
      e.sourceProductId !== relation.sourceProductId ||
      e.candidateSubstituteProductId !== relation.substituteProductId ||
      e.needUnitId !== relation.needUnitId
    )
      throw Error("SUBSTITUTION_SCORE_SCOPE_INVALID");
    const old = latest.get(e.id);
    if (old && old.eventId !== e.eventId)
      throw Error("SUBSTITUTION_SCORE_IDENTITY_CHANGED");
    if (
      old &&
      old.version === e.version &&
      JSON.stringify(old) !== JSON.stringify(e)
    )
      throw Error("SUBSTITUTION_SCORE_REVISION_AMBIGUOUS");
    if (!old || old.version < e.version) latest.set(e.id, e);
  }
  const ordered = [...latest.values()].sort(
    (a, b) =>
      (a.observationStart ?? a.eventStartedAt).localeCompare(
        b.observationStart ?? b.eventStartedAt,
      ) || a.id.localeCompare(b.id),
  );
  const decisions: ScoreEvidenceDecision[] = [];
  const used: SubstitutionEvidence[] = [];
  let observed = 0.5,
    support = 0,
    contradiction = 0;
  for (const e of ordered) {
    let reason: ScoreEvidenceDecision["reason"] = "USED";
    if (
      e.status !== "READY" ||
      !e.observationStart ||
      !e.observationEnd ||
      !e.eventEndedAt ||
      !e.observationDates.length ||
      !e.observationSalesIds.length
    )
      reason = "NOT_READY";
    else if (e.interpretation === "NEUTRAL") reason = "NEUTRAL";
    else if (!e.evidenceStrength || !e.dataQuality) reason = "NO_INFORMATION";
    else if (
      used.some(
        (u) =>
          u.eventId === e.eventId ||
          u.observationDates.some(
            (d) =>
              e.observationDates.includes(d) || e.referenceDates.includes(d),
          ) ||
          u.referenceDates.some((d) => e.observationDates.includes(d)) ||
          u.observationSalesIds.some((id) =>
            e.observationSalesIds.includes(id),
          ),
      )
    )
      reason = "DEPENDENT";
    decisions.push({
      evidenceId: e.id,
      version: e.version,
      inputRevision: e.inputRevision,
      reason,
    });
    if (reason !== "USED") continue;
    const confounded =
      e.partialEventDays ||
      e.concurrentCommercialOperationIds.length > 0 ||
      e.concurrentStoreEventIds.length > 0;
    const weight =
      policy.maxEvidenceStep *
      e.evidenceStrength! *
      e.dataQuality! *
      (confounded ? 0.5 : 1);
    const positive = e.interpretation === "SUPPORTS_SUBSTITUTION";
    observed += weight * ((positive ? 1 : 0) - observed);
    if (positive) support += weight;
    else contradiction += weight;
    used.push(e);
  }
  if (!used.length)
    return {
      status: "NO_INFORMATION" as const,
      policyVersion: policy.version,
      metrics: null,
      decisions,
    };
  // Unknown business components are omitted and weights renormalized, never zero-filled.
  const components: Array<[number | null, number]> = [
    [relation.needCompatibility, policy.needWeight],
    [relation.usageCompatibility, policy.usageWeight],
    [relation.priceCompatibility, policy.priceWeight],
    [relation.packagingCompatibility, policy.packagingWeight],
    [observed, policy.observedWeight],
  ];
  let score = 0,
    totalWeight = 0;
  for (const [value, weight] of components)
    if (value !== null) {
      score += value * weight;
      totalWeight += weight;
    }
  const information = support + contradiction;
  const agreement = Math.abs(support - contradiction) / information;
  const lastEvidenceAt = used
    .map((e) => e.eventEndedAt!)
    .sort()
    .at(-1)!;
  return {
    status: "CALCULATED" as const,
    policyVersion: policy.version,
    decisions,
    metrics: {
      observedSubstitution: rounded(observed),
      relationshipScore: rounded(score / totalWeight),
      confidence: rounded(
        policy.confidenceCeiling * (1 - Math.exp(-information)) * agreement,
      ),
      evidenceCount: used.length,
      lastEvidenceAt,
    },
  };
}
