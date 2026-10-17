import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotChoiceUpdatePreviewSchema,
  copilotChoiceUpdateProposalSchema,
  readCopilotChoiceUpdateProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildChoiceUpdateProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotChoiceUpdatePreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotChoiceUpdatePreviewSchema.parse(r);
    if (result.basis && result.basis.before.storeId !== assistant.storeId)
      throw Error("CHOICE_UPDATE_SCOPE_INVALID");
    latest.set(result.input.choiceId, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("CHOICE_UPDATE_LIMIT");
  return ready.map((result) => {
    const content = copilotChoiceUpdateProposalSchema.parse({
      kind: "COMMERCIAL_CHOICE_UPDATE_PROPOSAL",
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
    readCopilotChoiceUpdateProposal(message);
    return message;
  });
}
