import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotChoiceWithdrawalPreviewSchema,
  copilotChoiceWithdrawalProposalSchema,
  readCopilotChoiceWithdrawalProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildChoiceWithdrawalProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotChoiceWithdrawalPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotChoiceWithdrawalPreviewSchema.parse(r);
    if (result.before && result.before.storeId !== assistant.storeId)
      throw Error("CHOICE_WITHDRAWAL_SCOPE_INVALID");
    latest.set(result.input.choiceId, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("CHOICE_WITHDRAWAL_LIMIT");
  return ready.map((result) => {
    const content = copilotChoiceWithdrawalProposalSchema.parse({
      kind: "COMMERCIAL_CHOICE_WITHDRAWAL_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: result.input,
      before: result.before,
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
    readCopilotChoiceWithdrawalProposal(message);
    return message;
  });
}
