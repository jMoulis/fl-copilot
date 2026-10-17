import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotOfferValidationPreviewSchema,
  copilotOfferValidationProposalSchema,
  readCopilotOfferValidationProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildOfferValidationProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const parsed = raw.map((r) => copilotOfferValidationPreviewSchema.parse(r));
  if (parsed.some((r) => r.storeId !== assistant.storeId))
    throw Error("OFFER_VALIDATION_SCOPE_INVALID");
  const last = parsed.at(-1),
    ready = last?.status === "READY" ? [last] : [];
  return ready.map((result) => {
    const content = copilotOfferValidationProposalSchema.parse({
      kind: "OFFER_VALIDATION_PROPOSAL",
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
    readCopilotOfferValidationProposal(message);
    return message;
  });
}
