import type { CopilotCandidate } from "@fl-copilot/domain";
type Evidence = CopilotCandidate["evidence"][number];
/** Adding a native destination does not change a fact. Conflicting facts or two conflicting destinations remain ambiguous. */
export function sameCopilotEvidence(a: Evidence, b: Evidence) {
  const { analyticsContext: left, ...leftFact } = a,
    { analyticsContext: right, ...rightFact } = b;
  return (
    JSON.stringify(leftFact) === JSON.stringify(rightFact) &&
    (!left || !right || JSON.stringify(left) === JSON.stringify(right))
  );
}
export function preferEvidenceNavigation(
  a: Evidence | undefined,
  b: Evidence,
): Evidence {
  return !b.analyticsContext && a?.analyticsContext ? a : b;
}
