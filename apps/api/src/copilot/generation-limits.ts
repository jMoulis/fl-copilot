/** Initial context and completed tool reads have different bounds. A supported
 * analytical query can return 20 groups × 3 metrics × 4 values + one scope fact. */
export const COPILOT_INITIAL_EVIDENCE_LIMIT = 100;
export const COPILOT_TOOL_READ_LIMIT = 5;
// One original + three product resolutions + three reviewed offer proposals.
// Only original-choice-capable turns receive this workflow allowance.
export const COPILOT_ORIGINAL_CHOICE_TOOL_READ_LIMIT = 7;
export const COPILOT_READ_EVIDENCE_LIMIT = 20 * 3 * 4 + 1;
export const COPILOT_TOOL_EVIDENCE_LIMIT =
  Math.max(COPILOT_TOOL_READ_LIMIT, COPILOT_ORIGINAL_CHOICE_TOOL_READ_LIMIT) *
  COPILOT_READ_EVIDENCE_LIMIT;
export const COPILOT_COMPLETED_EVIDENCE_LIMIT =
  COPILOT_INITIAL_EVIDENCE_LIMIT + COPILOT_TOOL_EVIDENCE_LIMIT;
