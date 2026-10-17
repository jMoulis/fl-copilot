import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { productSchema } from "./products";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { choiceSaveRequestSchema } from "./copilot-commercial-choice";
export const copilotChoiceRetentionInputSchema = z.strictObject({
  choiceId: z.uuid(),
});
export const choiceRetentionBasisSchema = z.strictObject({
  before: commercialOfferChoiceSchema,
  product: productSchema,
});
export function choiceRetentionRequest(
  input: z.infer<typeof copilotChoiceRetentionInputSchema>,
  basis: z.infer<typeof choiceRetentionBasisSchema>,
  operationId: string,
) {
  const { before, product } = choiceRetentionBasisSchema.parse(basis);
  if (
    before.id !== input.choiceId ||
    before.status !== "WITHDRAWN" ||
    product.id !== before.productId ||
    product.storeId !== before.storeId ||
    product.status !== "ACTIVE" ||
    product.deletedAt
  )
    throw Error("CHOICE_RETENTION_SCOPE");
  const after = commercialOfferChoiceSchema.parse({
    ...before,
    status: "RETAINED",
  });
  const { id, storeId, version, createdAt, updatedAt, ...draft } = after;
  void id;
  void storeId;
  void createdAt;
  void updatedAt;
  return choiceSaveRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.choice.save",
    input: { expectedVersion: version, productVersion: product.version, draft },
  });
}
export const copilotChoiceRetentionPreviewSchema = z
  .strictObject({
    input: copilotChoiceRetentionInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: choiceRetentionBasisSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) => {
    if (!["READY", "UNCHANGED"].includes(v.status)) return v.basis === null;
    if (!v.basis || v.basis.before.id !== v.input.choiceId) return false;
    if (v.status === "UNCHANGED")
      return (
        v.basis.before.status === "RETAINED" &&
        v.basis.product.id === v.basis.before.productId &&
        v.basis.product.storeId === v.basis.before.storeId &&
        v.basis.product.status === "ACTIVE" &&
        !v.basis.product.deletedAt
      );
    try {
      choiceRetentionRequest(
        v.input,
        v.basis,
        "00000000-0000-4000-8000-000000000001",
      );
    } catch {
      return false;
    }
    return true;
  });
export const copilotChoiceRetentionProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_CHOICE_RETENTION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotChoiceRetentionInputSchema,
  basis: choiceRetentionBasisSchema,
});
export function readCopilotChoiceRetentionProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CHOICE_RETENTION_INVALID");
  const content = copilotChoiceRetentionProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.before.storeId !== message.storeId)
    throw Error("CHOICE_RETENTION_SCOPE");
  return {
    message,
    content,
    request: choiceRetentionRequest(content.input, content.basis, message.id),
  };
}
