import {
  copilotActionIntentSchema,
  copilotPriorityBatchSchema,
  copilotConflictReportSchema,
  type CopilotActionIntent,
  type CopilotTradeOff,
  type CopilotPriorityBatch,
} from "@fl-copilot/domain";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (a: string[]) => [...new Set(a)].sort(compare);
const opposed = (a: CopilotActionIntent, b: CopilotActionIntent) =>
  a.axis === b.axis &&
  (a.axis === "DISPLAY"
    ? (a.direction === "REDUCE" && b.direction !== "REDUCE") ||
      (b.direction === "REDUCE" && a.direction !== "REDUCE")
    : a.direction !== b.direction);
/** Preserve alternatives; never choose a winner, merge opposing actions or declare execution. */
export function detectCopilotConflicts(input: {
  batch: CopilotPriorityBatch;
  intents: readonly CopilotActionIntent[];
}) {
  const batch = copilotPriorityBatchSchema.parse(input.batch),
    candidates = new Map(batch.candidates.map((c) => [c.id, c]));
  if (candidates.size !== batch.candidates.length)
    throw Error("COPILOT_CONFLICT_DUPLICATE_CANDIDATE");
  for (const c of candidates.values())
    if (
      c.storeId !== batch.storeId ||
      c.eligibility.evaluatedAt !== batch.evaluatedAt
    )
      throw Error("COPILOT_CONFLICT_SCOPE_INVALID");
  const byId = new Map<string, CopilotActionIntent>();
  for (const raw of input.intents) {
    const i = copilotActionIntentSchema.parse(raw),
      c = candidates.get(i.candidateId);
    if (i.storeId !== batch.storeId)
      throw Error("COPILOT_CONFLICT_STORE_INVALID");
    if (!c) throw Error("COPILOT_CONFLICT_CANDIDATE_MISSING");
    if (!c.context.productIds.includes(i.productId))
      throw Error("COPILOT_CONFLICT_TARGET_INVALID");
    const old = byId.get(i.id);
    if (old && JSON.stringify(old) !== JSON.stringify(i))
      throw Error("COPILOT_CONFLICT_DIVERGENT_INTENT");
    byId.set(i.id, i);
  }
  const intents = [...byId.values()].sort((a, b) => compare(a.id, b.id));
  const ignoredIntents: Array<{
    id: string;
    reason: "CANDIDATE_NOT_ELIGIBLE" | "PAST_ACTION_WINDOW";
  }> = [];
  const eligible = intents.filter((i) => {
    const c = candidates.get(i.candidateId)!;
    if (c.status !== "ELIGIBLE" || c.priority.score === null) {
      ignoredIntents.push({ id: i.id, reason: "CANDIDATE_NOT_ELIGIBLE" });
      return false;
    }
    if (i.endsAt && Date.parse(i.endsAt) < Date.parse(batch.evaluatedAt)) {
      ignoredIntents.push({ id: i.id, reason: "PAST_ACTION_WINDOW" });
      return false;
    }
    return true;
  });
  const conflicts = new Map<string, CopilotTradeOff>();
  for (let x = 0; x < eligible.length; x++)
    for (const b of eligible.slice(x + 1)) {
      const a = eligible[x]!;
      if (a.productId !== b.productId || !opposed(a, b)) continue;
      const starts = [a.startsAt, b.startsAt]
          .filter((s): s is string => s !== null)
          .map((s) => Date.parse(s)),
        ends = [a.endsAt, b.endsAt]
          .filter((s): s is string => s !== null)
          .map((s) => Date.parse(s));
      const start = starts.length ? Math.max(...starts) : null,
        end = ends.length ? Math.min(...ends) : null;
      if (start !== null && end !== null && start > end) continue;
      if (a.candidateId === b.candidateId)
        throw Error("COPILOT_CONFLICT_INTERNAL_INTENT");
      const ids = [a.candidateId, b.candidateId].sort(compare) as [
        string,
        string,
      ];
      const id = JSON.stringify([
        "copilot-conflicts.v1",
        batch.storeId,
        ids,
        a.productId,
        a.axis,
      ]);
      const ca = candidates.get(ids[0])!,
        cb = candidates.get(ids[1])!;
      const known =
        a.startsAt !== null &&
        a.endsAt !== null &&
        b.startsAt !== null &&
        b.endsAt !== null;
      const previous = conflicts.get(id);
      const options = [
        ...new Map(
          [...(previous?.options ?? []), a, b].map((i) => [i.id, i]),
        ).values(),
      ].sort((a, b) => compare(a.id, b.id));
      // Multiple incompatible interval pairs cannot be represented as one precise interval.
      const sameInterval =
        !previous ||
        (previous.overlapStartsAt ===
          (start === null ? null : new Date(start).toISOString()) &&
          previous.overlapEndsAt ===
            (end === null ? null : new Date(end).toISOString()));
      conflicts.set(id, {
        id,
        productId: a.productId,
        axis: a.axis,
        candidateIds: ids,
        sourceCandidateIds: unique([
          ...ca.sourceCandidateIds,
          ...cb.sourceCandidateIds,
        ]),
        evidenceIds: unique([...ca.evidenceIds, ...cb.evidenceIds]),
        options,
        certainty:
          !known || previous?.certainty === "POSSIBLE_UNKNOWN_PERIOD"
            ? "POSSIBLE_UNKNOWN_PERIOD"
            : !sameInterval ||
                previous?.certainty === "MULTIPLE_OVERLAPPING_PERIODS"
              ? "MULTIPLE_OVERLAPPING_PERIODS"
              : "OVERLAPPING_PERIODS",
        overlapStartsAt:
          sameInterval && known && start !== null
            ? new Date(start).toISOString()
            : null,
        overlapEndsAt:
          sameInterval && known && end !== null
            ? new Date(end).toISOString()
            : null,
        resolution: "HUMAN_TRADE_OFF_REQUIRED",
      });
    }
  const tradeOffs = [...conflicts.values()].sort((a, b) => compare(a.id, b.id));
  const involved = new Set(tradeOffs.flatMap((t) => t.candidateIds)),
    eligibleIds = batch.candidates
      .filter((c) => c.status === "ELIGIBLE" && c.priority.score !== null)
      .map((c) => c.id);
  return copilotConflictReportSchema.parse({
    ruleVersion: "copilot-conflicts.v1",
    batch,
    intents,
    tradeOffs,
    ignoredIntents,
    independentCandidateIds: eligibleIds.filter((id) => !involved.has(id)),
    candidatesWithoutIntent: eligibleIds.filter(
      (id) => !eligible.some((i) => i.candidateId === id),
    ),
  });
}
