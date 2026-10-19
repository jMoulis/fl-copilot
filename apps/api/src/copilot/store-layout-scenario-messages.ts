import { createHash } from "node:crypto";
import {
  layoutScenarioPreviewSchema,
  layoutScenarioCardSchema,
  readStoreLayoutScenarioCard,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildStoreLayoutScenarioMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const last = raw.at(-1);
  if (!last) return [];
  const p = layoutScenarioPreviewSchema.parse(last);
  if (p.status !== "READY") return [];
  if (p.scenario!.storeId !== assistant.storeId)
    throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
  const content = layoutScenarioCardSchema.parse({
    kind: "STORE_LAYOUT_SCENARIO",
    schemaVersion: 1,
    assistantMessageId: assistant.id,
    scenario: p.scenario,
  });
  const hex = createHash("sha256")
      .update(assistant.id + JSON.stringify(content))
      .digest("hex"),
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const message = copilotMessageSchema.parse({
    ...assistant,
    id,
    role: "TOOL",
    text: JSON.stringify(content),
    attachments: [],
    createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
  });
  readStoreLayoutScenarioCard(message);
  return [message];
}
