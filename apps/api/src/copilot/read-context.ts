import { copilotMessageSchema } from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import type { CopilotMessage } from "@fl-copilot/domain";

/** Read-only rollout: canonical daily evidence is loaded by the turn service.
 * Do not manufacture eligible action candidates from conversation prose or bare KPI values.
 */
export async function loadCopilotReadContext(
  storeId: string,
  rawParent: CopilotMessage,
  now: () => Date = () => new Date(),
) {
  const parent = copilotMessageSchema.parse(rawParent);
  if (parent.storeId !== storeId || parent.role !== "USER")
    throw new Error("COPILOT_CONTEXT_SCOPE_INVALID");
  return detectCopilotConflicts({
    batch: scoreCopilotPriorities({
      storeId,
      evaluatedAt: now().toISOString(),
      candidates: [],
    }),
    intents: [],
  });
}
