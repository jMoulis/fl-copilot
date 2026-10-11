import {
  copilotPriorityPolicySchema,
  copilotPriorityBatchSchema,
  eligibleCopilotCandidateSchema,
  type CopilotPriorityPolicy,
  type EligibleCopilotCandidate,
  type CopilotPriorityBatch,
} from "@fl-copilot/domain";
import { BusinessDecimal } from "./decimal";
export const conservativeCopilotPriorityPolicy: CopilotPriorityPolicy = {
  version: "copilot-priority.v1",
  weights: {
    urgency: 0.3,
    economicImpact: 0.45,
    deviation: 0.05,
    dataQuality: 0.2,
  },
  deadlineBoosts: {
    within24Hours: 0.3,
    within48Hours: 0.15,
    within7Days: 0.05,
  },
};
const rounded = (v: InstanceType<typeof BusinessDecimal>) =>
  v.toDecimalPlaces(8).toNumber();
/** Conservative known-input score: null dimensions stay null and are never renormalized upwards. */
export function scoreCopilotPriorities(input: {
  storeId: string;
  evaluatedAt: string;
  candidates: readonly EligibleCopilotCandidate[];
  policy?: CopilotPriorityPolicy;
}): CopilotPriorityBatch {
  const policy = copilotPriorityPolicySchema.parse(
    input.policy ?? conservativeCopilotPriorityPolicy,
  );
  const candidates = input.candidates.map((raw) => {
    const c = eligibleCopilotCandidateSchema.parse(raw);
    if (c.storeId !== input.storeId)
      throw Error("COPILOT_PRIORITY_STORE_INVALID");
    if (c.eligibility.evaluatedAt !== input.evaluatedAt)
      throw Error("COPILOT_PRIORITY_STALE_ELIGIBILITY");
    const eligible = c.status === "ELIGIBLE";
    if (
      eligible &&
      c.deadlineAt &&
      Date.parse(c.deadlineAt) < Date.parse(input.evaluatedAt)
    )
      throw Error("COPILOT_PRIORITY_EXPIRED_ELIGIBILITY");
    const values = {
      urgency: c.urgencyScore,
      economicImpact: c.economicImpactScore,
      deviation: c.deviationScore,
      dataQuality: c.dataQualityScore,
    };
    const components = Object.fromEntries(
      Object.entries(values).map(([k, value]) => {
        const weight = policy.weights[k as keyof typeof values];
        return [
          k,
          {
            value,
            weight,
            contribution:
              eligible && value !== null
                ? rounded(new BusinessDecimal(value).times(weight))
                : null,
          },
        ];
      }),
    ) as CopilotPriorityBatch["candidates"][number]["priority"]["components"];
    const base = eligible
      ? rounded(
          Object.entries(values).reduce(
            (sum, [k, v]) =>
              v === null
                ? sum
                : sum.plus(
                    new BusinessDecimal(v).times(
                      policy.weights[k as keyof typeof values],
                    ),
                  ),
            new BusinessDecimal(0),
          ),
        )
      : null;
    const hours = c.deadlineAt
      ? (Date.parse(c.deadlineAt) - Date.parse(input.evaluatedAt)) / 3600000
      : null;
    const band = !eligible
      ? "NOT_SCORED"
      : hours === null
        ? "UNKNOWN"
        : hours <= 24
          ? "WITHIN_24_HOURS"
          : hours <= 48
            ? "WITHIN_48_HOURS"
            : hours <= 168
              ? "WITHIN_7_DAYS"
              : "LATER";
    const boost = !eligible
      ? null
      : band === "WITHIN_24_HOURS"
        ? policy.deadlineBoosts.within24Hours
        : band === "WITHIN_48_HOURS"
          ? policy.deadlineBoosts.within48Hours
          : band === "WITHIN_7_DAYS"
            ? policy.deadlineBoosts.within7Days
            : 0;
    return {
      ...c,
      priority: {
        score:
          base === null
            ? null
            : rounded(
                BusinessDecimal.min(1, new BusinessDecimal(base).plus(boost!)),
              ),
        baseScore: base,
        components,
        deadline: {
          remainingHours: hours !== null && hours >= 0 ? hours : null,
          boost,
          band,
        },
        missingDimensions: (
          Object.keys(values) as Array<keyof typeof values>
        ).filter((k) => values[k] === null),
        basis: "KNOWN_CONTRIBUTIONS_ONLY" as const,
      },
    };
  });
  const byId = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const old = byId.get(c.id);
    if (old && JSON.stringify(old) !== JSON.stringify(c))
      throw Error("COPILOT_PRIORITY_DIVERGENT_DUPLICATE");
    byId.set(c.id, c);
  }
  return copilotPriorityBatchSchema.parse({
    ruleVersion: policy.version,
    storeId: input.storeId,
    evaluatedAt: input.evaluatedAt,
    policy,
    candidates: [...byId.values()].sort((a, b) => {
      const delta = (b.priority.score ?? -1) - (a.priority.score ?? -1);
      return delta || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }),
  });
}
