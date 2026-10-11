import {
  copilotCandidateSchema,
  copilotEntitySnapshotSchema,
  copilotCandidateFactsSchema,
  copilotEligibilityPolicySchema,
  eligibleCopilotCandidateSchema,
  type CopilotCandidate,
  type CopilotEntitySnapshot,
  type CopilotCandidateFacts,
  type EligibleCopilotCandidate,
} from "@fl-copilot/domain";
export const conservativeCopilotEligibilityPolicy = {
  version: "copilot-eligibility.v1" as const,
  minimumDataQuality: 0.7,
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function uniqueSnapshots<T extends { storeId: string }>(
  values: readonly T[],
  storeId: string,
  key: (v: T) => string,
) {
  const result = new Map<string, T>();
  for (const v of values) {
    if (v.storeId !== storeId) throw Error("COPILOT_ELIGIBILITY_STORE_INVALID");
    const id = key(v),
      previous = result.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(v))
      throw Error("COPILOT_ELIGIBILITY_DIVERGENT_SNAPSHOT");
    result.set(id, v);
  }
  return result;
}
/** Evaluates prerequisites only. Nothing is discarded, ranked, executed or sent to a provider. */
export function filterCopilotEligibility(input: {
  storeId: string;
  evaluatedAt: string;
  candidates: readonly CopilotCandidate[];
  entities: readonly CopilotEntitySnapshot[];
  facts: readonly CopilotCandidateFacts[];
  policy?: typeof conservativeCopilotEligibilityPolicy;
}) {
  copilotEntitySnapshotSchema.shape.storeId.parse(input.storeId);
  eligibleCopilotCandidateSchema.shape.eligibility.shape.evaluatedAt.parse(
    input.evaluatedAt,
  );
  const policy = copilotEligibilityPolicySchema.parse(
    input.policy ?? conservativeCopilotEligibilityPolicy,
  );
  const entities = uniqueSnapshots(
    input.entities.map((e) => copilotEntitySnapshotSchema.parse(e)),
    input.storeId,
    (e) => e.id,
  );
  const facts = uniqueSnapshots(
    input.facts.map((f) => copilotCandidateFactsSchema.parse(f)),
    input.storeId,
    (f) => f.candidateId,
  );
  const candidates = uniqueSnapshots(
    input.candidates.map((c) => copilotCandidateSchema.parse(c)),
    input.storeId,
    (c) => c.id,
  );
  const result: EligibleCopilotCandidate[] = [];
  for (const c of candidates.values()) {
    const reasons: EligibleCopilotCandidate["eligibility"]["reasons"] = [];
    const add = (
      code: (typeof reasons)[number]["code"],
      severity: (typeof reasons)[number]["severity"],
      referenceId: string | null = null,
    ) => reasons.push({ code, severity, referenceId });
    const ids = [
      ...new Set([
        ...c.entityIds,
        ...c.context.productIds,
        ...c.context.operationIds,
        ...c.context.needUnitIds,
        ...c.context.relationshipIds,
      ]),
    ];
    for (const id of ids) {
      const e = entities.get(id);
      if (!e) {
        add("ENTITY_UNVERIFIED", "REVIEW", id);
        continue;
      }
      const expectedKinds = [
        ...(c.context.productIds.includes(id) ? ["PRODUCT"] : []),
        ...(c.context.operationIds.includes(id) ? ["OPERATION"] : []),
        ...(c.context.needUnitIds.includes(id) ? ["NEED"] : []),
        ...(c.context.relationshipIds.includes(id) ? ["RELATION"] : []),
      ];
      if (expectedKinds.some((kind) => kind !== e.kind))
        add("INVALID_ENTITY", "SUPPRESS", id);
      if (e.state === "INACTIVE" || e.state === "MISSING")
        add("INVALID_ENTITY", "SUPPRESS", id);
      if (e.syncState === "CONFLICT" || e.syncState === "ERROR")
        add("ENTITY_UNRESOLVED", "REVIEW", id);
      if (e.kind === "RELATION") {
        if (e.state === "REJECTED") add("RELATION_REJECTED", "SUPPRESS", id);
        else if (
          !e.humanConfirmed ||
          !["VALIDATED", "LEARNING"].includes(e.state)
        )
          add("RELATION_UNCONFIRMED", "REVIEW", id);
      }
      if (e.kind === "OPERATION") {
        if (e.state === "NOT_APPLICABLE")
          add("OPERATION_NOT_APPLICABLE", "SUPPRESS", id);
        else if (e.state !== "APPLICABLE")
          add("OPERATION_UNVERIFIED", "REVIEW", id);
      } else if (e.state === "UNKNOWN") add("ENTITY_UNVERIFIED", "REVIEW", id);
    }
    if (
      c.deadlineAt &&
      Date.parse(c.deadlineAt) < Date.parse(input.evaluatedAt)
    )
      add("OBSOLETE_DEADLINE", "SUPPRESS", c.deadlineAt);
    // A data-quality recommendation must remain possible precisely when quality is poor.
    if (!["VALIDATE_DATA", "WAIT_FOR_MORE_DATA"].includes(c.type)) {
      if (c.dataQualityScore === null) add("UNKNOWN_QUALITY", "REVIEW");
      else if (c.dataQualityScore < policy.minimumDataQuality)
        add("INSUFFICIENT_QUALITY", "REVIEW");
    }
    const f = facts.get(c.id);
    if (!f) add("FACTS_UNVERIFIED", "REVIEW");
    else {
      if (f.sourceCurrent === false) add("STALE_SOURCE", "SUPPRESS");
      else if (f.sourceCurrent === null) add("SOURCE_UNVERIFIED", "REVIEW");
      if (f.criticalAmbiguity) add("CRITICAL_AMBIGUITY", "REVIEW");
      for (const missing of f.missingCriticalFacts)
        add("MISSING_CRITICAL_FACT", "REVIEW", missing);
      if (f.executionRequired && f.executionComplete !== true)
        add("INCOMPLETE_EXECUTION", "REVIEW");
    }
    if (
      ["CONSIDER_LOCAL_PROMOTION", "CONSIDER_LOT_SALE"].includes(c.type) &&
      f?.purchaseCostKnown !== true
    )
      add("MISSING_REQUIRED_COST", "REVIEW");
    const stable = [
      ...new Map(reasons.map((r) => [JSON.stringify(r), r])).values(),
    ].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    result.push(
      eligibleCopilotCandidateSchema.parse({
        ...c,
        status: stable.some((r) => r.severity === "SUPPRESS")
          ? "SUPPRESSED"
          : stable.length
            ? "TO_REVIEW"
            : "ELIGIBLE",
        eligibility: {
          ruleVersion: policy.version,
          evaluatedAt: input.evaluatedAt,
          policy,
          reasons: stable,
        },
      }),
    );
  }
  return {
    ruleVersion: policy.version,
    storeId: input.storeId,
    candidates: result.sort((a, b) => compare(a.id, b.id)),
  };
}
