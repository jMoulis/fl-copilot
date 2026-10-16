import { createHash } from "node:crypto";
import {
  hasPreparationLayoutChange,
  validatePreparationBasis,
  copilotMessageSchema,
  copilotPreparationPreviewSchema,
  copilotPreparationProposalSchema,
  readCopilotPreparationProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildPreparationProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotPreparationPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotPreparationPreviewSchema.parse(r);
    if (result.basis)
      validatePreparationBasis(assistant.storeId, result.input, result.basis);
    const key = result.input.weekStart;
    latest.set(key, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_PREPARATION_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = copilotPreparationProposalSchema.parse({
      kind: "COMMERCIAL_PREPARATION_PROPOSAL",
      schemaVersion: result.input.patch.offerSelection
        ? 4
        : result.input.create
          ? 3
          : hasPreparationLayoutChange(result.input)
            ? 2
            : 1,
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
    readCopilotPreparationProposal(message);
    return message;
  });
}
