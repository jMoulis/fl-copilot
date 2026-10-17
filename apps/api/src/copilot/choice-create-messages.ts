import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotChoiceCreatePreviewSchema,
  copilotChoiceCreateProposalSchema,
  readCopilotChoiceCreateProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildChoiceCreateProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotChoiceCreatePreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotChoiceCreatePreviewSchema.parse(r);
    if (result.basis && result.basis.storeId !== assistant.storeId)
      throw Error("CHOICE_CREATE_SCOPE_INVALID");
    latest.set(JSON.stringify(result.input.source), result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("CHOICE_CREATE_LIMIT");
  return ready.map((result) => {
    const content = copilotChoiceCreateProposalSchema.parse({
      kind: "COMMERCIAL_CHOICE_CREATE_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: result.input,
      basis: result.basis,
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
    readCopilotChoiceCreateProposal(message);
    return message;
  });
}
