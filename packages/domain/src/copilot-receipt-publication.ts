import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const COPILOT_RECEIPT_REVIEW_LINE_LIMIT = 100;
/** No date, amount, identity decision or validation authority is model-supplied. */
export const receiptPublicationInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
});
export const receiptPublicationSourceSchema = z.strictObject({
  storeId: z.uuid(),
  sourceDocumentId: z.uuid(),
  checksum: z.string().min(1).max(240),
  filename: z.string().min(1).max(240),
});
export const receiptPublicationPreviewSchema = z.strictObject({
  input: receiptPublicationInputSchema,
  source: receiptPublicationSourceSchema,
  status: z.enum([
    "REVIEW_LOCAL",
    "ALREADY_PUBLISHED",
    "NOT_READY",
    "LIMIT_EXCEEDED",
  ]),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export const receiptPublicationProposalSchema = z.strictObject({
  kind: z.literal("WASTE_PUBLICATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  source: receiptPublicationSourceSchema,
});
export function readReceiptPublicationProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("RECEIPT_PUBLICATION_PROPOSAL_INVALID");
  const content = receiptPublicationProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.source.storeId !== message.storeId)
    throw Error("RECEIPT_PUBLICATION_SCOPE");
  return { message, content };
}
/** Fingerprint of the complete current native review, never an AI assertion. */
export const receiptPublicationRequestSchema = z.strictObject({
  operationId: z.uuid(),
  sourceDocumentId: z.uuid(),
  receiptId: z.uuid(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const receiptPublicationAuthoritySchema =
  productClassificationAuthoritySchema
    .omit({ canManageProducts: true })
    .extend({ canPublishWaste: z.boolean(), receiptReviewed: z.boolean() });
export type ReceiptPublicationAuthority = z.infer<
  typeof receiptPublicationAuthoritySchema
>;
export const receiptPublicationResultSchema = z.strictObject({
  operationId: z.uuid(),
  userMessageId: z.uuid(),
  appliedAt: z.iso.datetime(),
  sourceDocumentId: z.uuid(),
  receiptId: z.uuid(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  commandId: z.uuid(),
  publishedCount: z
    .number()
    .int()
    .min(1)
    .max(COPILOT_RECEIPT_REVIEW_LINE_LIMIT),
});
