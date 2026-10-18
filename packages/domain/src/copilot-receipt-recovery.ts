import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
import {
  receiptPublicationRequestSchema,
  receiptPublicationSourceSchema,
} from "./copilot-receipt-publication";
import { wasteReceiptSchema } from "./waste-receipts";
export const receiptRecoveryActionSchema = z.enum([
  "RETRY_PROCESSING",
  "KEEP_BOTH",
  "CONFIRM_DUPLICATE",
]);
export const receiptRecoveryInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
  action: receiptRecoveryActionSchema,
});
export const receiptRecoveryPreviewSchema = z.strictObject({
  input: receiptRecoveryInputSchema,
  source: receiptPublicationSourceSchema,
  status: z.enum(["REVIEW_LOCAL", "READ_ONLY"]),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export const receiptRecoveryProposalSchema = z.strictObject({
  kind: z.literal("WASTE_RECOVERY_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: receiptRecoveryInputSchema,
  source: receiptPublicationSourceSchema,
});
export function readReceiptRecoveryProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("RECEIPT_RECOVERY_INVALID");
  const content = receiptRecoveryProposalSchema.parse(JSON.parse(message.text));
  if (
    content.source.storeId !== message.storeId ||
    content.source.sourceDocumentId !== content.input.sourceDocumentId
  )
    throw Error("RECEIPT_RECOVERY_SCOPE");
  return { message, content };
}
export const receiptRecoveryRequestSchema =
  receiptPublicationRequestSchema.extend({
    action: receiptRecoveryActionSchema,
  });
export const receiptRecoveryAuthoritySchema =
  productClassificationAuthoritySchema
    .omit({ canManageProducts: true })
    .extend({ canRecoverWaste: z.boolean(), recoveryReviewed: z.boolean() });
export type ReceiptRecoveryAuthority = z.infer<
  typeof receiptRecoveryAuthoritySchema
>;
export const receiptRecoveryStateSchema = z.strictObject({
  processingStatus: wasteReceiptSchema.shape.processingStatus,
  aiStatus: wasteReceiptSchema.shape.aiStatus,
  duplicateStatus: wasteReceiptSchema.shape.duplicateStatus,
});
export const receiptRecoveryResultSchema = receiptRecoveryRequestSchema.extend({
  userMessageId: z.uuid(),
  appliedAt: z.iso.datetime(),
  before: receiptRecoveryStateSchema,
  after: receiptRecoveryStateSchema,
});
