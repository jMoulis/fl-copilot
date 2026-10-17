import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotChoiceReassociationPreviewSchema,
  copilotChoiceReassociationProposalSchema,
  readCopilotChoiceReassociationProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildChoiceReassociationProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotChoiceReassociationPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotChoiceReassociationPreviewSchema.parse(r);
    if (result.basis && result.basis.before.storeId !== assistant.storeId)
      throw Error("CHOICE_REASSOCIATION_SCOPE_INVALID");
    latest.set(result.input.choiceId, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("CHOICE_REASSOCIATION_LIMIT");
  return ready.map((result) => {
    const content = copilotChoiceReassociationProposalSchema.parse({
      kind: "COMMERCIAL_CHOICE_REASSOCIATION_PROPOSAL",
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
    readCopilotChoiceReassociationProposal(message);
    return message;
  });
}
