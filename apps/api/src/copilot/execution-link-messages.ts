import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  executionLinkPreviewSchema,
  executionLinkProposalSchema,
  readExecutionLinkProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildExecutionLinkMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const previews = new Map<
    string,
    ReturnType<typeof executionLinkPreviewSchema.parse>
  >();
  for (const value of raw) {
    const r = executionLinkPreviewSchema.parse(value);
    if (
      r.snapshot?.task.storeId !== undefined &&
      r.snapshot.task.storeId !== assistant.storeId
    )
      throw Error("COPILOT_EXECUTION_LINK_SCOPE_INVALID");
    previews.set(JSON.stringify(r.input), r);
  }
  const ready = [...previews.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_EXECUTION_LINK_LIMIT");
  return ready.map((r) => {
    const content = executionLinkProposalSchema.parse({
      kind: "EXECUTION_LINK_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: r.input,
      snapshot: r.snapshot,
    });
    const h = createHash("sha256")
      .update(assistant.id + JSON.stringify(content))
      .digest("hex");
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const m = copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readExecutionLinkProposal(m);
    return m;
  });
}
