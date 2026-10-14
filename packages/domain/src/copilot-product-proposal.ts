import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import {
  copilotProductPreviewInputSchema,
  compareProductClassification,
} from "./copilot-product-preview";
import { productSchema } from "./products";
export const copilotProductProposalSchema = z.strictObject({
  kind: z.literal("PRODUCT_CLASSIFICATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.string().uuid(),
  before: productSchema,
  patch: copilotProductPreviewInputSchema.shape.patch,
});
/** Typed TOOL content is preparation only, never a trusted user decision. */
export function readCopilotProductProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("COPILOT_PROPOSAL_INVALID");
  const proposal = copilotProductProposalSchema.parse(JSON.parse(message.text));
  if (
    proposal.before.storeId !== message.storeId ||
    proposal.before.deletedAt ||
    proposal.before.status === "INACTIVE"
  )
    throw Error("COPILOT_PROPOSAL_SCOPE_INVALID");
  const preview = compareProductClassification(proposal.before, proposal.patch);
  if (!preview.changedFields.length) throw Error("COPILOT_PROPOSAL_NO_CHANGE");
  return { message, proposal, preview };
}
