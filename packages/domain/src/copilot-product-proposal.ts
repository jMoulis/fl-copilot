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
export const copilotProductBatchProposalSchema = z.strictObject({
  kind: z.literal("PRODUCT_CLASSIFICATION_BATCH_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.string().uuid(),
  items: z
    .array(copilotProductProposalSchema.pick({ before: true, patch: true }))
    .min(2)
    .max(10)
    .refine(
      (items) =>
        new Set(items.map((item) => item.before.id)).size === items.length,
    ),
});
export const copilotProductProposalContentSchema = z.discriminatedUnion(
  "kind",
  [copilotProductProposalSchema, copilotProductBatchProposalSchema],
);
/** Typed TOOL content is preparation only, never a trusted user decision. */
export function readCopilotProductProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("COPILOT_PROPOSAL_INVALID");
  const proposal = copilotProductProposalContentSchema.parse(
    JSON.parse(message.text),
  );
  const rawItems =
    proposal.kind === "PRODUCT_CLASSIFICATION_PROPOSAL"
      ? [proposal]
      : proposal.items;
  const items = rawItems.map((item) => {
    if (
      item.before.storeId !== message.storeId ||
      item.before.deletedAt ||
      item.before.status === "INACTIVE"
    )
      throw Error("COPILOT_PROPOSAL_SCOPE_INVALID");
    const preview = compareProductClassification(item.before, item.patch);
    if (!preview.changedFields.length)
      throw Error("COPILOT_PROPOSAL_NO_CHANGE");
    return { ...item, preview };
  });
  return { message, proposal, items, preview: items[0]!.preview };
}
