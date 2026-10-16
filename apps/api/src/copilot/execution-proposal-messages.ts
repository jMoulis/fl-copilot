import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotExecutionPreviewResultSchema,
  copilotExecutionProposalSchema,
  readCopilotExecutionProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildExecutionProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotExecutionPreviewResultSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotExecutionPreviewResultSchema.parse(r);
    if (result.preview && result.preview.proposal.storeId !== assistant.storeId)
      throw Error("COPILOT_EXECUTION_PROPOSAL_SCOPE_INVALID");
    latest.set(result.input.taskId, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_EXECUTION_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = copilotExecutionProposalSchema.parse({
      kind: "COMMERCIAL_EXECUTION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: result.input,
      ...result.preview!,
    });
    const hex = createHash("sha256")
      .update(assistant.id + JSON.stringify(content))
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const message = copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readCopilotExecutionProposal(message);
    return message;
  });
}
