import {
  copilotCandidateSchema,
  weeklyCopilotCandidateSchema,
  type CopilotCandidate,
  type WeeklyCopilotCandidate,
  type CandidateContext,
} from "@fl-copilot/domain";
import type { AnalyticalCandidate } from "./candidates";
export const candidateAggregationVersion = "copilot-candidates.v1" as const;
const unique = (v: readonly string[]) => [...new Set(v)].sort();
function normalizeEvidence(values: CopilotCandidate["evidence"]) {
  const byId = new Map<string, CopilotCandidate["evidence"][number]>();
  for (const e of values) {
    const existing = byId.get(e.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(e))
      throw Error("COPILOT_EVIDENCE_DIVERGENT_DUPLICATE");
    byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
function context(v: CandidateContext): CandidateContext {
  return {
    ...v,
    productIds: unique(v.productIds),
    operationIds: unique(v.operationIds),
    needUnitIds: unique(v.needUnitIds),
    relationshipIds: unique(v.relationshipIds),
    sourceLineageIds: unique(v.sourceLineageIds),
    missingData: unique(v.missingData),
  };
}
/** Normalization only: no eligibility decision, ranking, prose, provider or mutation. */
export function aggregateCopilotCandidates(input: {
  storeId: string;
  analyticalCandidates: readonly AnalyticalCandidate[];
  weeklyCommercialCandidates: readonly WeeklyCopilotCandidate[];
  analyticalContexts?: Readonly<Record<string, CandidateContext>>;
}) {
  weeklyCopilotCandidateSchema.shape.storeId.parse(input.storeId);
  const candidates: CopilotCandidate[] = [];
  const mapping = {
    WASTE_SPIKE: "MONITOR_HIGH_WASTE",
    SALES_DROP: "INVESTIGATE_SALES_DROP",
    MARGIN_DROP: "INVESTIGATE_MARGIN_DROP",
    DATA_QUALITY_ALERT: "VALIDATE_DATA",
  } as const;
  for (const a of input.analyticalCandidates) {
    if (a.storeId !== input.storeId)
      throw Error("COPILOT_CANDIDATE_STORE_INVALID");
    if (!(a.type in mapping)) throw Error("COPILOT_ANALYTICAL_TYPE_INVALID");
    const c = input.analyticalContexts?.[a.id] ?? {
      productIds: a.entityType === "PRODUCT" ? [a.entityId] : [],
      operationIds: a.entityType === "COMMERCIAL_OPERATION" ? [a.entityId] : [],
      relationshipIds:
        a.entityType === "SUBSTITUTION_RELATION" ? [a.entityId] : [],
      needUnitIds: [],
      sourceLineageIds: [],
      planRevisionId: null,
      missingData: [],
      availability: "UNKNOWN" as const,
    };
    const evidence = a.evidence.map((e) => ({
      id: JSON.stringify([
        "analytical-evidence.v1",
        a.id,
        e.sourceType,
        e.sourceId,
        e.label,
      ]),
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceVersion: null,
      label: e.label,
      value: e.value ?? null,
      factKind:
        e.sourceType === "DATA_QUALITY"
          ? ("QUALITY" as const)
          : ("DERIVED" as const),
    }));
    candidates.push(
      copilotCandidateSchema.parse({
        id: JSON.stringify([
          candidateAggregationVersion,
          input.storeId,
          "ANALYTICAL",
          a.id,
        ]),
        storeId: a.storeId,
        sourceCandidateIds: [a.id],
        origin: "ANALYTICAL",
        sourceType: a.type,
        type: mapping[a.type],
        scope: "DAILY",
        entityIds: [a.entityId],
        businessDate: a.businessDate,
        weekStart: null,
        urgencyScore: a.urgencyScore,
        economicImpactScore: a.economicImpactScore,
        deviationScore: a.deviationScore,
        dataQualityScore: a.dataQualityScore,
        relationshipScore: null,
        relationshipConfidence: null,
        deadlineAt: null,
        evidence,
        evidenceIds: unique(evidence.map((e) => e.id)),
        context: context({
          ...c,
          sourceLineageIds: [...c.sourceLineageIds, ...a.sourceLineageIds],
        }),
        warnings: unique([
          ...a.warnings,
          ...(a.status === "LOW_QUALITY" ? ["LOW_DATA_QUALITY"] : []),
        ]),
        status: "TO_REVIEW",
      }),
    );
  }
  for (const raw of input.weeklyCommercialCandidates) {
    const a = weeklyCopilotCandidateSchema.parse(raw);
    if (a.storeId !== input.storeId)
      throw Error("COPILOT_CANDIDATE_STORE_INVALID");
    candidates.push(
      copilotCandidateSchema.parse({
        ...a,
        id: JSON.stringify([
          candidateAggregationVersion,
          input.storeId,
          "WEEKLY_COMMERCIAL",
          a.id,
        ]),
        sourceCandidateIds: [a.id],
        origin: "WEEKLY_COMMERCIAL",
        scope: "WEEKLY",
        businessDate: null,
        entityIds: unique(a.entityIds),
        evidence: [...a.evidence].sort((x, y) => x.id.localeCompare(y.id)),
        evidenceIds: unique(a.evidence.map((e) => e.id)),
        context: context(a.context),
        warnings: unique(a.warnings),
        status: "TO_REVIEW",
      }),
    );
  }
  const byId = new Map<string, CopilotCandidate>();
  for (const candidate of candidates) {
    candidate.evidence = normalizeEvidence(candidate.evidence);
    const existing = byId.get(candidate.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candidate))
      throw Error("COPILOT_CANDIDATE_DIVERGENT_DUPLICATE");
    byId.set(candidate.id, candidate);
  }
  return {
    ruleVersion: candidateAggregationVersion,
    storeId: input.storeId,
    candidates: [...byId.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
}
